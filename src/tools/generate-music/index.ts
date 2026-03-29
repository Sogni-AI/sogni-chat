/**
 * generate_music tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Turn this into a video', prompt: 'Turn that song into a video' },
  { label: 'Try a different genre', prompt: 'Generate a different genre of music' },
  { label: 'Make it longer', prompt: 'Generate a longer version of this track' },
];

toolRegistry.register({ definition, execute, suggestions, sideEffectLevel: 'write', timeoutMs: 660_000 });
