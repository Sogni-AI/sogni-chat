/**
 * generate_video tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Make it longer', prompt: 'Generate a longer version of this video' },
  { label: 'Try a different scene', prompt: 'Generate a different scene with the same style' },
  { label: 'Add dialogue', prompt: 'Generate a similar video but with spoken dialogue' },
];

toolRegistry.register({ definition, execute, suggestions, sideEffectLevel: 'write', timeoutMs: 600_000 });
