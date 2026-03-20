import type { ToolExecutionContext, ToolCallbacks } from '../types';
import { saveContentFilter } from '@/config/contentFilterPreset';

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  _callbacks: ToolCallbacks,
): Promise<string> {
  const enabled = args.enabled as boolean;

  // Disabling the filter requires user confirmation via the popup
  if (!enabled) {
    const confirmed = await context.requestDisableContentFilter?.();
    if (!confirmed) {
      return JSON.stringify({
        success: false,
        safeContentFilter: true,
        message: 'User declined to disable the content filter.',
      });
    }

    // The popup flow already handled storage + React state updates.
    // Only mutate the context so subsequent tool calls in the same loop see the updated value.
    context.safeContentFilter = false;

    console.log('[SET CONTENT FILTER] Safe Content Filter disabled');
    return JSON.stringify({
      success: true,
      safeContentFilter: false,
      message: 'Safe Content Filter is now disabled. Generated content will no longer be checked by the safety filter.',
    });
  }

  // Re-enabling the filter — no popup needed
  saveContentFilter(enabled);
  context.onContentFilterChange?.(enabled);
  context.safeContentFilter = enabled;

  console.log('[SET CONTENT FILTER] Safe Content Filter enabled');
  return JSON.stringify({
    success: true,
    safeContentFilter: enabled,
    message: 'Safe Content Filter is now enabled.',
  });
}
