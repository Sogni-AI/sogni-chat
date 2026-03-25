/**
 * orbit_video tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: '360\u00B0 orbit', prompt: 'Create a 360 degree orbit around this image' },
    { label: 'Turntable view', prompt: 'Make a turntable spin video of this' },
  ],
});
