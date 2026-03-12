/**
 * Quality tier presets for restoration.
 * Fast uses Lightning model, HQ uses the standard Qwen Image Edit model.
 */

export type QualityTier = 'fast' | 'hq';

export interface QualityPreset {
  model: string;
  steps: number;
  guidance: number;
  outputFormat: 'jpg' | 'png';
  label: string;
  description: string;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  fast: {
    model: 'qwen_image_edit_2511_fp8_lightning',
    steps: 5,
    guidance: 1.0,
    outputFormat: 'jpg',
    label: 'Standard',
    description: 'Faster',
  },
  hq: {
    model: 'qwen_image_edit_2511_fp8',
    steps: 25,
    guidance: 4.0,
    outputFormat: 'jpg',
    label: 'High Quality',
    description: 'More detail',
  },
};

export const DEFAULT_QUALITY: QualityTier = 'fast';

const QUALITY_STORAGE_KEY = 'sogni:qualityTier';

export function getSavedQualityTier(): QualityTier {
  const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
  if (saved === 'fast' || saved === 'hq') return saved;
  return DEFAULT_QUALITY;
}

export function saveQualityTier(tier: QualityTier): void {
  localStorage.setItem(QUALITY_STORAGE_KEY, tier);
}
