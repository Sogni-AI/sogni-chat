/**
 * generate_image tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try a different style', prompt: 'Generate the same scene in a different art style' },
  { label: 'Make it wider', prompt: 'Generate a wider landscape version' },
  { label: 'Generate more variations', prompt: 'Generate 4 more variations' },
];

toolRegistry.register({ definition, execute, suggestions });
