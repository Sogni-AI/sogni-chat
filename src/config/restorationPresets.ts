/**
 * Restoration preset categories -- each generation uses a different
 * restoration philosophy so the user gets genuinely varied results.
 */

export interface RestorationPreset {
  id: string;
  label: string;
  prompt: string;
}

export const RESTORATION_PRESETS: RestorationPreset[] = [
  {
    id: 'gentle',
    label: 'Gentle Restore',
    prompt:
      'Carefully restore this photograph with minimal intervention, remove visible scratches and surface damage while faithfully preserving the original tone, grain, and character',
  },
  {
    id: 'deep-clean',
    label: 'Deep Clean',
    prompt:
      'Thoroughly clean and repair this damaged photograph, remove all scratches, tears, stains, dust, and age-related damage for a pristine result',
  },
  {
    id: 'color-revival',
    label: 'Color Revival',
    prompt:
      'Restore this photograph and revive its colors, correct fading and discoloration, enhance contrast and color balance while repairing any physical damage',
  },
  {
    id: 'full-remaster',
    label: 'Full Remaster',
    prompt:
      'Fully remaster this vintage photograph, repair all damage, sharpen details, enhance clarity, and modernize the image quality while respecting the original composition',
  },
];

export type RestorationModeId = 'gentle' | 'deep-clean' | 'color-revival' | 'full-remaster';

const MODE_STORAGE_KEY = 'sogni:restorationMode';
const DEFAULT_MODE: RestorationModeId = 'gentle';

export function getSavedRestorationMode(): RestorationModeId {
  const saved = localStorage.getItem(MODE_STORAGE_KEY);
  if (RESTORATION_PRESETS.some(p => p.id === saved)) return saved as RestorationModeId;
  return DEFAULT_MODE;
}

export function saveRestorationMode(mode: RestorationModeId): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
}

/** Return N presets, starting with selectedMode first, then cycling the rest. */
export function getPresetsForCount(n: number, selectedMode?: RestorationModeId): RestorationPreset[] {
  const ordered = [...RESTORATION_PRESETS];
  if (selectedMode) {
    const selectedIndex = ordered.findIndex(p => p.id === selectedMode);
    if (selectedIndex > 0) {
      const [selected] = ordered.splice(selectedIndex, 1);
      ordered.unshift(selected);
    }
  }
  const presets: RestorationPreset[] = [];
  for (let i = 0; i < n; i++) {
    presets.push(ordered[i % ordered.length]);
  }
  return presets;
}
