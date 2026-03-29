import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';

toolRegistry.register({ definition, execute, sideEffectLevel: 'write' });
