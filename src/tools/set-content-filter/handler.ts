import type { ToolExecutionContext, ToolCallbacks } from '../types';
import { saveContentFilter } from '@/config/contentFilterPreset';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  _callbacks: ToolCallbacks,
): Promise<string> {
  const enabled = args.enabled as boolean;

  // Persist to localStorage
  saveContentFilter(enabled);

  // Update React state so the UI toggle reflects the change immediately
  context.onContentFilterChange?.(enabled);

  // Also mutate the context directly so subsequent tool calls in the same
  // loop iteration see the updated value without waiting for a React re-render
  context.safeContentFilter = enabled;

  const status = enabled ? 'enabled' : 'disabled';
  console.log(`[SET CONTENT FILTER] Safe Content Filter ${status}`);

  return JSON.stringify({
    success: true,
    safeContentFilter: enabled,
    message: `Safe Content Filter is now ${status}.${!enabled ? ' Generated content will no longer be checked by the safety filter.' : ''}`,
  });
}
