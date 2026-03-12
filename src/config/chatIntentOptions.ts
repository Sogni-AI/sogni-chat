/**
 * Damage type options for the visual intent capture card.
 * Users select damage types to guide the restoration prompt.
 */

export interface DamageOption {
  id: string;
  label: string;
  promptFragment: string;
}

export const DAMAGE_OPTIONS: DamageOption[] = [
  { id: 'scratches', label: 'Scratches & tears', promptFragment: 'remove scratches and tears' },
  { id: 'fading', label: 'Fading & discoloration', promptFragment: 'fix fading and discoloration' },
  { id: 'stains', label: 'Stains & spots', promptFragment: 'clean up stains and spots' },
  { id: 'blur', label: 'Blur & softness', promptFragment: 'sharpen blurry areas' },
  { id: 'missing', label: 'Missing parts', promptFragment: 'reconstruct missing areas' },
  { id: 'noise', label: 'Noise & grain', promptFragment: 'reduce noise and grain' },
];

export const QUICK_RESTORE_MESSAGE = 'Do a full restoration of this photo — fix any damage and enhance quality.';

/**
 * Synthesize a user message from selected damage options + optional context.
 */
export function synthesizeIntentMessage(selectedIds: string[], additionalContext: string): string {
  const selected = DAMAGE_OPTIONS.filter(opt => selectedIds.includes(opt.id));
  if (selected.length === 0) return QUICK_RESTORE_MESSAGE;

  const tasks = selected.map(opt => opt.promptFragment);
  const taskList = tasks.length === 1
    ? tasks[0]
    : `${tasks.slice(0, -1).join(', ')}, and ${tasks[tasks.length - 1]}`;

  let message = `Restore this photo: ${taskList}.`;
  if (additionalContext.trim()) {
    message += ` Also: ${additionalContext.trim()}`;
  }
  return message;
}
