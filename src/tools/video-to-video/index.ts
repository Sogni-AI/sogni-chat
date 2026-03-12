/**
 * video_to_video tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
import type { ToolSuggestion } from '../types';

const suggestions: ToolSuggestion[] = [
  { label: 'Try a different control mode', prompt: 'Apply a different control mode to the same video' },
  { label: 'Try depth mode', prompt: 'Transform the video using depth mapping' },
  { label: 'Enhance quality', prompt: 'Use the detailer mode to enhance the video quality' },
];

toolRegistry.register({ definition, execute, suggestions });
