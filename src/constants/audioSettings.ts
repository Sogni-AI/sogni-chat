/**
 * Audio/Music Generation Settings — ACE-Step Models
 *
 * Configuration for the ACE-Step 1.5 music generation models.
 * Based on workflow_text_to_music.mjs model parameters.
 */

export interface AudioModelConfig {
  /** SDK model ID */
  id: string;
  /** Display name */
  name: string;
  /** Inference steps range */
  steps: { min: number; max: number; default: number };
  /** Denoising shift range */
  shift: { min: number; max: number; default: number };
  /** CFG guidance range (null = not supported, e.g. turbo) */
  guidance: { min: number; max: number; default: number } | null;
}

export const AUDIO_MODELS: Record<string, AudioModelConfig> = {
  turbo: {
    id: 'ace_step_1.5_turbo',
    name: 'ACE-Step 1.5 Turbo',
    steps: { min: 4, max: 16, default: 8 },
    shift: { min: 1, max: 5, default: 3 },
    guidance: null,
  },
  sft: {
    id: 'ace_step_1.5_sft',
    name: 'ACE-Step 1.5 SFT',
    steps: { min: 10, max: 200, default: 50 },
    shift: { min: 1, max: 5, default: 3 },
    guidance: { min: 1, max: 15, default: 5 },
  },
};

/** Default audio model key */
export const DEFAULT_AUDIO_MODEL = 'turbo';

/** Duration constraints for music generation */
export const AUDIO_DURATION = {
  min: 10,
  max: 600,
  default: 30,
} as const;

/** BPM constraints */
export const AUDIO_BPM = {
  min: 30,
  max: 300,
  default: 120,
} as const;

/** Valid time signatures */
export const AUDIO_TIME_SIGNATURES = [2, 3, 4, 6] as const;
export type AudioTimeSignature = (typeof AUDIO_TIME_SIGNATURES)[number];
