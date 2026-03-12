/**
 * Model variant definitions for the model selector dropdown.
 * Maps user-facing model choices to actual model IDs and parameters.
 */

import { CHAT_MODEL, CHAT_MODEL_ABLITERATED } from './chat';

export interface ModelVariant {
  id: string;
  label: string;
  sublabel: string;
  modelId: string;
  /** true = extended thinking, false = disabled, undefined = use default */
  think?: boolean;
  unrestricted: boolean;
}

export const MODEL_VARIANTS: ModelVariant[] = [
  {
    id: 'auto',
    label: 'Creative Agent 1.0',
    sublabel: 'Auto',
    modelId: CHAT_MODEL,
    think: undefined,  // Use default behavior
    unrestricted: false,
  },
  {
    id: 'standard',
    label: 'Creative Agent 1.0',
    sublabel: 'Answers right away',
    modelId: CHAT_MODEL,
    think: false,
    unrestricted: false,
  },
  {
    id: 'thinking',
    label: 'Creative Agent 1.0',
    sublabel: 'Thinks longer for better answers',
    modelId: CHAT_MODEL,
    think: true,
    unrestricted: false,
  },
  {
    id: 'unrestricted',
    label: 'Creative Agent 1.0',
    sublabel: 'Unrestricted',
    modelId: CHAT_MODEL_ABLITERATED,
    think: false,
    unrestricted: true,
  },
  {
    id: 'thinking-unrestricted',
    label: 'Creative Agent 1.0',
    sublabel: 'Thinking + Unrestricted',
    modelId: CHAT_MODEL_ABLITERATED,
    think: true,
    unrestricted: true,
  },
];

export const DEFAULT_VARIANT_ID = 'auto';

export function getVariantById(id: string): ModelVariant {
  return MODEL_VARIANTS.find(v => v.id === id) ?? MODEL_VARIANTS[0];
}
