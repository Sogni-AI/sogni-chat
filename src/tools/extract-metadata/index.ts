import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Generate a new version', prompt: 'Generate a new version of this image using the extracted settings' },
    { label: 'Different prompt, same settings', prompt: 'Use these generation settings but with a different prompt' },
    { label: 'What model was used?', prompt: 'What model was used to generate this?' },
  ],
});
