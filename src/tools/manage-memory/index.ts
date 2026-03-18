/**
 * Self-registration for manage_memory tool.
 */
import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({ definition, execute });
