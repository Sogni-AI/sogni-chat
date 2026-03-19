/**
 * Handler for manage_memory tool.
 * CRUD operations on persistent user memories via userDataDB.
 */

import type { ToolExecutionContext, ToolCallbacks } from '../types';
import type { Memory } from '@/types/userData';
import { getAllMemories, upsertMemoryByKey, deleteMemoryByKey } from '@/utils/userDataDB';

/** Notify useMemories hooks in all tabs to refresh */
function notifyMemoryUpdate(): void {
  // Notify the current tab via custom event (BroadcastChannel only reaches OTHER tabs)
  window.dispatchEvent(new CustomEvent('sogni-memories-updated'));

  // Notify other tabs via BroadcastChannel
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel('sogni-memories-sync');
    channel.postMessage({ type: 'memories-updated' });
    channel.close();
  } catch { /* ignore */ }
}

export async function execute(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const action = args.action as string;
  const key = args.key as string | undefined;
  const value = args.value as string | undefined;
  const category = (args.category as Memory['category']) || 'preference';
  const validCategories: Memory['category'][] = ['preference', 'fact', 'context'];
  const safeCategory: Memory['category'] = validCategories.includes(category) ? category : 'preference';

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'manage_memory',
    totalCount: 1,
    stepLabel: action === 'read' ? 'Reading memories...' : action === 'write' ? 'Saving memory...' : 'Deleting memory...',
  });

  try {
    switch (action) {
      case 'read': {
        const memories = await getAllMemories();
        callbacks.onToolProgress({ type: 'completed', toolName: 'manage_memory', progress: 1 });
        callbacks.onToolComplete('manage_memory', []);

        if (memories.length === 0) {
          return JSON.stringify({
            success: true,
            memories: [],
            message: 'No saved memories yet.',
          });
        }

        return JSON.stringify({
          success: true,
          memories: memories.map(m => ({
            key: m.key,
            value: m.value,
            category: m.category,
            source: m.source,
          })),
          message: `Found ${memories.length} saved memories.`,
        });
      }

      case 'write': {
        if (!key || !value) {
          callbacks.onToolComplete('manage_memory', []);
          return JSON.stringify({
            error: 'missing_params',
            message: 'Both "key" and "value" are required for write action.',
          });
        }

        const { created } = await upsertMemoryByKey(key, value, safeCategory, 'llm');
        notifyMemoryUpdate();

        // Notify chat UI to render a memory-saved chip
        window.dispatchEvent(new CustomEvent('sogni-memory-saved', { detail: { key, value } }));

        callbacks.onToolProgress({ type: 'completed', toolName: 'manage_memory', progress: 1 });
        callbacks.onToolComplete('manage_memory', []);

        return JSON.stringify({
          success: true,
          action: created ? 'created' : 'updated',
          key,
          value,
          message: created
            ? `Saved new memory "${key}": "${value}".`
            : `Updated memory "${key}" to "${value}".`,
        });
      }

      case 'delete': {
        if (!key) {
          callbacks.onToolComplete('manage_memory', []);
          return JSON.stringify({
            error: 'missing_params',
            message: '"key" is required for delete action.',
          });
        }

        await deleteMemoryByKey(key);
        notifyMemoryUpdate();

        callbacks.onToolProgress({ type: 'completed', toolName: 'manage_memory', progress: 1 });
        callbacks.onToolComplete('manage_memory', []);

        return JSON.stringify({
          success: true,
          action: 'deleted',
          key,
          message: `Deleted memory "${key}".`,
        });
      }

      default:
        callbacks.onToolComplete('manage_memory', []);
        return JSON.stringify({
          error: 'invalid_action',
          message: `Unknown action "${action}". Use "read", "write", or "delete".`,
        });
    }
  } catch (err: unknown) {
    console.error('[MANAGE MEMORY] Failed:', err);
    callbacks.onToolComplete('manage_memory', []);
    return JSON.stringify({
      error: 'memory_failed',
      message: `Memory operation failed: ${(err as Error).message || 'Unknown error'}`,
    });
  }
}
