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

  /** Execute a tool by name */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    callbacks: ToolCallbacks,
  ): Promise<string> {
    const handler = this.handlers.get(name);
    if (!handler) {
      console.error(`[TOOL REGISTRY] Unknown tool: "${name}". Available: ${Array.from(this.handlers.keys()).join(', ')}`);
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    try {
      return await handler.execute(args, context, callbacks);
    } catch (err) {
      console.error(`[TOOL REGISTRY] Unexpected error executing "${name}":`, err);
      return JSON.stringify({ error: `Unexpected error executing ${name}: ${err instanceof Error ? err.message : String(err)}` });
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
