/**
 * sound_to_video tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try a different visual style', prompt: 'Generate another video with a different visual style' },
  { label: 'Try a different section', prompt: 'Generate a video starting from a different part of the audio' },
  { label: 'Adjust the duration', prompt: 'Make the video match the full audio length' },
];

toolRegistry.register({ definition, execute, suggestions });
