/**
 * refine_result tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Refine more', prompt: 'Refine more' },
  { label: 'Try a different approach', prompt: 'Try a different approach' },
  { label: 'Animate this', prompt: 'Animate this' },
];

toolRegistry.register({ definition, execute, suggestions, sideEffectLevel: 'write' });
