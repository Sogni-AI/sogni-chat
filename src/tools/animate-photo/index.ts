/**
 * animate_photo tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Make it longer', prompt: 'Make it longer' },
  { label: 'Try a different motion', prompt: 'Try a different motion' },
  { label: 'Generate another video', prompt: 'Generate another video' },
];

toolRegistry.register({ definition, execute, suggestions });
