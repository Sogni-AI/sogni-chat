/**
 * dance_montage tool registration.
 * Importing this module auto-registers the tool with the registry.
 */

import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Try a different dance', prompt: 'Try a different dance' },
    { label: 'Make it longer', prompt: 'Make the dance video longer' },
    { label: 'Try with another photo', prompt: 'Try with a different photo' },
  ],
  sideEffectLevel: 'write',
  timeoutMs: 600_000,
});
