/**
 * Tool registry — singleton that manages all tool handlers.
 *
 * Tools self-register by importing this module and calling `toolRegistry.register()`.
 * The chat service uses `getDefinitions()` to pass tool schemas to the LLM and
 * `execute()` to dispatch tool calls by name.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import type { ToolHandler, ToolExecutionContext, ToolCallbacks, ToolSuggestion } from './types';

class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  private static readonly DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

  private static readonly TIMEOUT_OVERRIDES: Record<string, number> = {
    generate_music: 660_000,
    video_to_video: 660_000,
    generate_video: 300_000,
    animate_photo: 300_000,
    extract_metadata: 60_000,
  };

  /** Register a tool handler */
  register(handler: ToolHandler): void {
    const name = handler.definition.function.name;
    if (this.handlers.has(name)) {
      console.warn(`[TOOL REGISTRY] Overwriting existing handler for "${name}"`);
    }
    this.handlers.set(name, handler);
    console.log(`[TOOL REGISTRY] Registered tool: ${name}`);
  }

  /** Get all tool definitions (for passing to the LLM) */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.handlers.values()).map(h => h.definition);
  }

  /** Check if a tool is registered */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Validate and clean tool arguments against the tool's schema */
  private validateArgs(
    definition: ToolDefinition,
    args: Record<string, unknown>
  ): { valid: true; cleaned: Record<string, unknown> } | { valid: false; error: string } {
    // Handle parse errors from parseChatToolArgs
    if (args.__parseError) {
      return { valid: false, error: 'Failed to parse tool arguments — malformed JSON from LLM' };
    }

    const params = definition.function.parameters as {
      properties?: Record<string, { type?: string }>;
      required?: string[];
    } | undefined;
    if (!params?.properties) return { valid: true, cleaned: args };

    const cleaned: Record<string, unknown> = {};
    const required = new Set(params.required || []);

    // Check required params
    for (const name of required) {
      if (!(name in args) || args[name] === undefined || args[name] === null) {
        return { valid: false, error: `Missing required parameter: ${name}` };
      }
    }

    // Copy known params, strip unknown ones, type-coerce where safe
    for (const [key, value] of Object.entries(args)) {
      if (key in params.properties) {
        const prop = params.properties[key];
        if (prop.type === 'number' && typeof value === 'string') {
          const num = Number(value);
          if (!isNaN(num)) {
            console.debug(`[TOOL REGISTRY] Coerced "${key}" from string to number for ${definition.function.name}`);
            cleaned[key] = num;
            continue;
          }
        }
        if (prop.type === 'boolean' && typeof value === 'string') {
          console.debug(`[TOOL REGISTRY] Coerced "${key}" from string to boolean for ${definition.function.name}`);
          cleaned[key] = value === 'true';
          continue;
        }
        cleaned[key] = value;
      } else {
        console.warn(`[TOOL REGISTRY] Stripping unknown parameter "${key}" from ${definition.function.name}`);
      }
    }

    return { valid: true, cleaned };
  }

  /** Execute a tool by name */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    callbacks: ToolCallbacks,
  ): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) {
      console.error(`[TOOL REGISTRY] Unknown tool: "${name}". Available: ${this.getToolNames().join(', ')}`);
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    // Validate arguments against tool schema
    const validation = this.validateArgs(handler.definition, args);
    if (!validation.valid) {
      console.warn(`[TOOL REGISTRY] Invalid args for "${name}": ${validation.error}`);
      return JSON.stringify({ error: validation.error });
    }

    const timeoutMs = ToolRegistry.TIMEOUT_OVERRIDES[name] ?? ToolRegistry.DEFAULT_TIMEOUT_MS;

    // Wrap caller's signal with timeout-aware AbortController
    const timeoutController = new AbortController();
    const originalSignal = context.signal;
    if (originalSignal?.aborted) {
      timeoutController.abort();
    } else {
      originalSignal?.addEventListener('abort', () => timeoutController.abort(), { once: true });
    }

    const timeoutId = setTimeout(() => {
      console.warn(`[TOOL REGISTRY] Timeout: "${name}" exceeded ${timeoutMs / 1000}s — aborting`);
      timeoutController.abort();
    }, timeoutMs);

    const timeoutContext = { ...context, signal: timeoutController.signal };

    try {
      const result = await handler.execute(validation.cleaned, timeoutContext, callbacks);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);

      if (timeoutController.signal.aborted && !originalSignal?.aborted) {
        console.error(`[TOOL REGISTRY] "${name}" timed out after ${timeoutMs / 1000}s`);
        return JSON.stringify({
          error: `${name} timed out. The operation took too long — try a simpler prompt or smaller output.`,
        });
      }

      console.error(`[TOOL REGISTRY] Error executing "${name}":`, message);
      return JSON.stringify({ error: `Unexpected error executing ${name}: ${message}` });
    }
  }

  /** Get suggestion chips for a specific tool */
  getSuggestions(toolName: string): ToolSuggestion[] {
    return this.handlers.get(toolName)?.suggestions ?? [];
  }

  /** Get all registered tool names */
  getToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export const toolRegistry = new ToolRegistry();
