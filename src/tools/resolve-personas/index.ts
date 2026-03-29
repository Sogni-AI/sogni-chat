/**
 * Self-registration for resolve_personas tool.
 */
import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Generate an image with them', prompt: 'Generate an image featuring them' },
    { label: 'Create a portrait', prompt: 'Create a portrait of them' },
  ],
  sideEffectLevel: 'read',
  canRunInParallel: true,
});
