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
  { label: 'Use a different model', prompt: 'Try the LTX 2.3 audio-to-video model instead' },
  { label: 'Adjust the duration', prompt: 'Make the video match the full audio length' },
];

toolRegistry.register({ definition, execute, suggestions });
