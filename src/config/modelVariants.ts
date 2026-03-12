/**
 * Model variant definitions for the model selector dropdown.
 * Maps user-facing model choices to actual model IDs and parameters.
 */

import { CHAT_MODEL, CHAT_MODEL_ABLITERATED } from './chat';

export interface ModelVariant {
  id: string;
  /** Short name shown in the dropdown menu */
  menuLabel: string;
  /** Description shown below the menu label */
  description: string;
  /** Suffix shown after "Sogni Creative Agent 1.0" in the header button */
  headerSuffix: string;
  modelId: string;
  /** true = extended thinking, false = disabled, undefined = use default */
  think?: boolean;
  unrestricted: boolean;
}

export const MODEL_VARIANTS: ModelVariant[] = [
  {
    id: 'auto',
    menuLabel: 'Auto',
    description: 'Decides how long to think',
    headerSuffix: 'Auto',
    modelId: CHAT_MODEL,
    think: undefined,
    unrestricted: false,
  },
  {
    id: 'instant',
    menuLabel: 'Instant',
    description: 'Answers right away',
    headerSuffix: 'Instant',
    modelId: CHAT_MODEL,
    think: false,
    unrestricted: false,
  },
  {
    id: 'thinking',
    menuLabel: 'Thinking',
    description: 'Thinks longer for better answers',
    headerSuffix: 'Thinking',
    modelId: CHAT_MODEL,
    think: true,
    unrestricted: false,
  },
  {
    id: 'unrestricted',
    menuLabel: 'Unrestricted',
    description: 'No content restrictions',
    headerSuffix: 'Unrestricted',
    modelId: CHAT_MODEL_ABLITERATED,
    think: false,
    unrestricted: true,
  },
  {
    id: 'thinking-unrestricted',
    menuLabel: 'Thinking + Unrestricted',
    description: 'Extended thinking, no restrictions',
    headerSuffix: 'Thinking + Unrestricted',
    modelId: CHAT_MODEL_ABLITERATED,
    think: true,
    unrestricted: true,
  },
];

export const DEFAULT_VARIANT_ID = 'auto';

export function getVariantById(id: string): ModelVariant {
  return MODEL_VARIANTS.find(v => v.id === id) ?? MODEL_VARIANTS[0];
}
