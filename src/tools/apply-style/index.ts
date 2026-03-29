/**
 * apply_style tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Apply another style', prompt: 'Apply another style' },
  { label: 'Animate this', prompt: 'Animate this' },
  { label: 'Refine the result', prompt: 'Refine the result' },
];

toolRegistry.register({ definition, execute, suggestions, sideEffectLevel: 'write' });
