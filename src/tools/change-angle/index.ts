/**
 * change_angle tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try another angle', prompt: 'Try another angle' },
  { label: 'Animate this view', prompt: 'Animate this view' },
  { label: 'Apply a style', prompt: 'Apply a style' },
];

toolRegistry.register({ definition, execute, suggestions });
