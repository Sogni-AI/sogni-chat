/**
 * Tool definition for manage_memory.
 * Reads, writes, and deletes persistent user preferences and facts.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'manage_memory',
    description:
      'Save, read, or delete user preferences and facts that persist across conversations. Call with action "write" when user states a preference ("I like watercolor style", "always use 16:9"). Call with action "read" to recall preferences before generating. Call with action "delete" to remove a preference. Do NOT save transient requests — only persistent preferences.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'delete'],
          description: 'Action to perform. "read": list all saved memories. "write": save or update a preference. "delete": remove a preference by key.',
        },
        key: {
          type: 'string',
          description: 'Unique key for the memory (e.g. "preferred_style", "aspect_ratio", "quality_preference"). Required for write and delete.',
        },
        value: {
          type: 'string',
          description: 'Value to save. Required for write action. Be concise but specific.',
        },
        category: {
          type: 'string',
          enum: ['preference', 'fact', 'context'],
          description: 'Memory category. "preference": style/format preferences. "fact": user facts (name, location). "context": project context. Default: "preference".',
        },
      },
      required: ['action'],
    },
  },
};
