/**
 * restore_photo tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try a different style', prompt: 'Try a different style' },
  { label: 'Animate this photo', prompt: 'Animate this photo' },
  { label: 'Generate another version', prompt: 'Generate another version' },
];

toolRegistry.register({ definition, execute, suggestions, sideEffectLevel: 'write' });
