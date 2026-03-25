/**
 * stitch_video tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Stitch my videos', prompt: 'Stitch all my video clips together into one video' },
  ],
});
