/**
 * edit_image tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try a different combination', prompt: 'Combine the images differently' },
  { label: 'Use a different model', prompt: 'Try the same edit with the Flux2 model' },
  { label: 'Adjust the style', prompt: 'Make it more artistic and painterly' },
];

toolRegistry.register({ definition, execute, suggestions });
