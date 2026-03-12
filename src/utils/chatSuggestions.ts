/**
 * Pure function to generate context-aware suggestion chips
 * based on the current chat message history.
 */
import type { UIChatMessage } from '@/types/chat';
import { RESTORATION_PRESETS, type RestorationModeId } from '@/config/restorationPresets';

/** Tool names used in chat — must match ToolName union from tools/types.ts */
type ChatToolName =
  | 'restore_photo'
  | 'apply_style'
  | 'refine_result'
  | 'animate_photo'
  | 'change_angle'
  | 'generate_image'
  | 'edit_image'
  | 'generate_video'
  | 'sound_to_video'
  | 'video_to_video'
  | 'generate_music'
  | 'analyze_image';

/** A suggestion chip with display label and prompt text sent on click */
export interface Suggestion {
  label: string;
  prompt: string;
}

/** Suggestions shown when the user has uploaded an image */
const WELCOME_SUGGESTIONS: Suggestion[] = [
  { label: 'Restore this photo', prompt: 'Restore this photo' },
  { label: 'Apply an artistic style', prompt: 'Apply an artistic style to this photo' },
  { label: 'Animate this photo', prompt: 'Animate this photo with gentle movement' },
];

/** Suggestions shown when no image is uploaded — text-to-image/video/music prompts */
const NO_IMAGE_SUGGESTIONS: Suggestion[] = [
  { label: 'Generate an image', prompt: 'Generate an image of a magical forest with bioluminescent mushrooms, soft fog, and moonlight filtering through ancient trees' },
  { label: 'Create a video', prompt: 'Generate a video of a cozy cafe on a rainy night, warm light inside, gentle camera push-in' },
  { label: 'Compose a song', prompt: 'Generate a dreamy indie pop track, 110 BPM, with reverb-heavy guitars and atmospheric synth pads' },
  { label: 'Make a music video', prompt: 'Generate a video of abstract colorful paint swirling in water, synchronized to a deep electronic beat' },
];

const SUGGESTIONS_BY_TOOL: Record<ChatToolName, Suggestion[]> = {
  restore_photo: [
    { label: 'Apply a Norman Rockwell style', prompt: 'Apply a Norman Rockwell style' },
    { label: 'Bring it to life', prompt: 'Animate this photo with a gentle smile and subtle movement' },
    { label: 'Try different variations', prompt: 'Try different variations' },
  ],
  apply_style: [
    { label: 'Try a different style', prompt: 'Try a different style' },
    { label: 'Restore the original instead', prompt: 'Restore the original instead' },
    { label: 'Refine this result', prompt: 'Refine this result' },
  ],
  refine_result: [
    { label: 'Apply an artistic style', prompt: 'Apply an artistic style' },
    { label: 'Bring it to life', prompt: 'Animate this photo with gentle movement' },
    { label: 'Start fresh with new settings', prompt: 'Start fresh with new settings' },
  ],
  animate_photo: [
    { label: 'Try a different animation', prompt: 'Animate it differently -- try a gentle wave' },
    { label: 'View from another angle', prompt: 'Show me this from a different angle' },
    { label: 'Restore the photo', prompt: 'Restore the original photo' },
  ],
  change_angle: [
    { label: 'Try another angle', prompt: 'Show me from the other side' },
    { label: 'Bring it to life', prompt: 'Animate this with subtle movement' },
    { label: 'Restore the photo', prompt: 'Restore the original photo' },
  ],
  generate_image: [
    { label: 'Try a different style', prompt: 'Generate the same scene in a different art style' },
    { label: 'Make it wider', prompt: 'Generate a wider landscape version' },
    { label: 'Animate this result', prompt: 'Animate this into a short video clip' },
  ],
  edit_image: [
    { label: 'Edit it further', prompt: 'Make another edit to this result' },
    { label: 'Try a different style', prompt: 'Apply an artistic style to this' },
    { label: 'Animate it', prompt: 'Bring this to life with gentle movement' },
  ],
  generate_video: [
    { label: 'Try different motion', prompt: 'Generate a new video with different camera movement' },
    { label: 'Generate an image instead', prompt: 'Generate a still image of this scene' },
    { label: 'Add music', prompt: 'Generate a soundtrack for this video' },
  ],
  sound_to_video: [
    { label: 'Try different visuals', prompt: 'Generate a new video with different visuals for the same audio' },
    { label: 'Change the style', prompt: 'Redo this with a different visual style' },
    { label: 'Generate new music', prompt: 'Generate a different track and sync video to it' },
  ],
  video_to_video: [
    { label: 'Try a different style', prompt: 'Transform this video with a different style' },
    { label: 'Adjust the strength', prompt: 'Redo with less transformation to keep more of the original' },
    { label: 'Generate music for it', prompt: 'Compose background music for this video' },
  ],
  generate_music: [
    { label: 'Try a different genre', prompt: 'Generate another track in a different genre' },
    { label: 'Sync to video', prompt: 'Create a video synced to this music' },
    { label: 'Adjust the tempo', prompt: 'Generate a similar track but faster tempo' },
  ],
  analyze_image: [
    { label: 'Read the text', prompt: 'Extract all visible text from this image' },
    { label: 'Edit based on analysis', prompt: 'Edit this image to improve it' },
    { label: 'Generate something similar', prompt: 'Generate a new image inspired by this one' },
  ],
};

/**
 * Parse [SUGGEST:Label|Prompt] tags from vision analysis text.
 * Returns cleaned text (tags stripped) and extracted suggestions.
 */
export function parseAnalysisSuggestions(text: string): {
  cleanedText: string;
  suggestions: Suggestion[];
} {
  const suggestions: Suggestion[] = [];
  const cleanedText = text.replace(/\[SUGGEST:(.+?)\|(.+?)\]/g, (_match, label, prompt) => {
    suggestions.push({ label: label.trim(), prompt: prompt.trim() });
    return '';
  }).trim();

  return { cleanedText, suggestions };
}

/**
 * Strip [SUGGEST:...] tags from text for live display during streaming.
 * Removes both complete tags and partial tags being streamed at the end.
 */
export function stripSuggestTagsForDisplay(text: string): string {
  // Strip complete [SUGGEST:...|...] tags
  let cleaned = text.replace(/\[SUGGEST:[^\]]*\]/g, '');
  // Strip any trailing unclosed bracket (partial tag being streamed)
  cleaned = cleaned.replace(/\[[^\]]*$/, '');
  return cleaned.trimEnd();
}

/**
 * Build a "Full Restore" prompt from the individual analysis suggestions.
 * Produces something like: "Do a full restoration: remove damage, repair borders, revive colors, and enhance clarity"
 */
function buildFullRestorePrompt(suggestions: Suggestion[], mode?: RestorationModeId): string {
  const modePreset = mode ? RESTORATION_PRESETS.find(p => p.id === mode) : null;
  if (modePreset) return modePreset.prompt;
  if (suggestions.length === 0) return 'Do a full restoration of this photo';
  const tasks = suggestions.map((s) => s.prompt.toLowerCase());
  if (tasks.length === 1) return `Do a full restoration: ${tasks[0]}`;
  const allButLast = tasks.slice(0, -1).join(', ');
  return `Do a full restoration: ${allButLast}, and ${tasks[tasks.length - 1]}`;
}

export function getRestoreModeLabel(mode: RestorationModeId): string {
  return RESTORATION_PRESETS.find(p => p.id === mode)?.label || 'Full Restore';
}

export function getRestoreModePrompt(mode: RestorationModeId, analysisSuggestions?: Suggestion[]): string {
  return buildFullRestorePrompt(analysisSuggestions || [], mode);
}

export function generateSuggestions(
  messages: UIChatMessage[],
  analysisSuggestions?: Suggestion[],
  hasImage?: boolean,
): Suggestion[] {
  // Walk backwards to find the last assistant message with a completed tool
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.lastCompletedTool) {
      return SUGGESTIONS_BY_TOOL[msg.lastCompletedTool as ChatToolName] ?? [];
    }
  }

  // No tool has been used yet -- use analysis suggestions if available.
  // Prepend restoration mode chips (one per preset) so users can single-click to restore.
  // Filter out any LLM-generated suggestions that duplicate the restore chips
  // (e.g. "Full Restoration", "Full Restore", "Complete Restoration").
  if (analysisSuggestions && analysisSuggestions.length > 0) {
    const filtered = analysisSuggestions.filter(
      (s) => !/^(full|complete|gentle|deep|color|remaster)\s*/i.test(s.label),
    );
    const modeChips: Suggestion[] = RESTORATION_PRESETS.map((preset) => ({
      label: preset.label,
      prompt: buildFullRestorePrompt(analysisSuggestions, preset.id as RestorationModeId),
    }));
    return [
      ...modeChips,
      ...filtered,
    ];
  }

  // Fallback: show image-upload suggestions or text-only creation suggestions
  if (messages.length > 0 && messages[0].role === 'assistant') {
    return hasImage ? WELCOME_SUGGESTIONS : NO_IMAGE_SUGGESTIONS;
  }

  return hasImage === false ? NO_IMAGE_SUGGESTIONS : [];
}
