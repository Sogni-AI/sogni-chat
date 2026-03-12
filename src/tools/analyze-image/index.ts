/**
 * Self-registration for analyze_image tool.
 */
import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({
  definition,
  execute,
  suggestions: [
    { label: 'Read the text', prompt: 'Read all visible text in this image' },
    { label: 'Edit this image', prompt: 'Edit this image based on the analysis' },
    { label: 'Generate a similar image', prompt: 'Generate a new image inspired by this one' },
  ],
});
