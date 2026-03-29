/**
 * Pure function to generate context-aware suggestion chips
 * based on the current chat message history.
 */
import type { UIChatMessage } from '@/types/chat';
import { RESTORATION_PRESETS, type RestorationModeId } from '@/config/restorationPresets';

/** Tool names used in chat — subset of ToolName union (excludes set_content_filter which has no suggestions) */
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
  | 'analyze_image'
  | 'extract_metadata'
  | 'resolve_personas'
  | 'manage_memory'
  | 'dance_montage';

/** A suggestion chip with display label and prompt text sent on click */
export interface Suggestion {
  label: string;
  prompt: string;
}

/** Suggestions shown when the user has uploaded an image */
const WELCOME_SUGGESTIONS: Suggestion[] = [
  { label: 'Restore this photo', prompt: 'Restore this photo' },
  { label: 'Creative transformation', prompt: 'Give this photo a creative transformation — surprise me' },
  { label: 'Apply an artistic style', prompt: 'Apply an artistic style to this photo' },
  { label: 'Animate this photo', prompt: 'Animate this photo' },
];

/** Suggestions shown when uploadIntent is 'edit' and an image has been uploaded */
export const EDIT_INTENT_SUGGESTIONS: Suggestion[] = [
  { label: 'As a famous painting', prompt: 'Transform this into a famous Renaissance painting, preserving my likeness' },
  { label: 'As a superhero', prompt: 'Reimagine me as a Marvel superhero with a dramatic pose and cinematic lighting' },
  { label: 'Anime transformation', prompt: 'Transform this photo into a Studio Ghibli anime character' },
  { label: 'Generate variations', prompt: 'Generate variations of this photo' },
  { label: 'Change the angle', prompt: 'Change the viewing angle of this photo' },
];

/** Suggestions shown when audio is uploaded without an image */
const AUDIO_UPLOAD_SUGGESTIONS: Suggestion[] = [
  { label: 'Turn this into a video', prompt: 'Turn this audio into a video' },
  { label: 'Visualize this music', prompt: 'Create an audio-reactive visualization for this music' },
  { label: 'Generate an image first', prompt: 'Generate an image to use as a reference frame for this audio' },
];

/** Suggestions shown when both audio and image are uploaded */
const AUDIO_IMAGE_UPLOAD_SUGGESTIONS: Suggestion[] = [
  { label: 'Turn this into a video', prompt: 'Turn this audio into a video using this image' },
  { label: 'Visualize with this image', prompt: 'Create an audio-reactive video using this image as the starting frame' },
];

/** Suggestions shown when no image is uploaded — short prompts that trigger LLM conversation */
const NO_IMAGE_SUGGESTIONS: Suggestion[] = [
  { label: 'Generate an image', prompt: 'Generate an image' },
  { label: 'Create a video', prompt: 'Create a video' },
  { label: 'Compose a song', prompt: 'Compose a song' },
  { label: 'Make a music video', prompt: 'Make a music video' },
];

/** Suggestions shown when no personas exist — includes personalization CTA */
const NO_PERSONAS_SUGGESTIONS: Suggestion[] = [
  { label: 'Generate an image', prompt: 'Generate an image' },
  { label: 'Create a video', prompt: 'Create a video' },
  { label: 'Compose a song', prompt: 'Compose a song' },
];

const SUGGESTIONS_BY_TOOL: Record<ChatToolName, Suggestion[]> = {
  restore_photo: [
    { label: 'As a famous painting', prompt: 'Now transform this into a famous painting style' },
    { label: 'Apply an artistic style', prompt: 'Apply an artistic style' },
    { label: 'Bring it to life', prompt: 'Animate this photo' },
    { label: 'Try different variations', prompt: 'Try different variations' },
  ],
  apply_style: [
    { label: 'Try a different vibe', prompt: 'Try a completely different creative style — something unexpected' },
    { label: 'As a movie character', prompt: 'Reimagine this as a cinematic movie character portrait' },
    { label: 'Refine this result', prompt: 'Refine this result' },
    { label: 'Try the original', prompt: 'Restore the original instead' },
  ],
  refine_result: [
    { label: 'Try another vibe', prompt: 'Try a completely different creative transformation' },
    { label: 'Apply an artistic style', prompt: 'Apply an artistic style' },
    { label: 'Bring it to life', prompt: 'Animate this photo' },
  ],
  animate_photo: [
    { label: 'Try different motion', prompt: 'Animate it with different motion' },
    { label: 'Add dialogue', prompt: 'Animate it again but have the subject speak' },
    { label: 'Make it longer', prompt: 'Make a longer version of this video' },
    { label: 'Try a different style', prompt: 'Animate it with a different visual style' },
  ],
  change_angle: [
    { label: 'Try another angle', prompt: 'Show me from another angle' },
    { label: 'Bring it to life', prompt: 'Animate this' },
    { label: 'Restore the photo', prompt: 'Restore the original photo' },
  ],
  generate_image: [
    { label: 'Edit this image', prompt: 'Edit this image' },
    { label: 'Generate variations', prompt: 'Generate a few variations of this' },
    { label: 'Apply a style', prompt: 'Apply an artistic style to this' },
    { label: 'Animate into a video', prompt: 'Animate this into a video' },
  ],
  edit_image: [
    { label: 'Try another vibe', prompt: 'Try a completely different creative transformation on this' },
    { label: 'Edit it further', prompt: 'Make another edit to this result' },
    { label: 'Animate it', prompt: 'Animate this' },
  ],
  generate_video: [
    { label: 'Try different motion', prompt: 'Generate a new video with different motion' },
    { label: 'Add dialogue', prompt: 'Regenerate with the subject speaking' },
    { label: 'Make it longer', prompt: 'Generate a longer version of this video' },
    { label: 'Generate an image instead', prompt: 'Generate a still image of this scene' },
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
    { label: 'Turn this into a video', prompt: 'Turn that song into a video' },
    { label: 'Video with an image', prompt: 'Turn that song into a video using this image' },
    { label: 'Try a different genre', prompt: 'Try a different genre' },
    { label: 'Add lyrics', prompt: 'Generate a version with lyrics' },
  ],
  analyze_image: [
    { label: 'Read the text', prompt: 'Extract all visible text from this image' },
    { label: 'Edit based on analysis', prompt: 'Edit this image to improve it' },
    { label: 'Generate something similar', prompt: 'Generate a new image inspired by this one' },
  ],
  extract_metadata: [
    { label: 'Generate a new version', prompt: 'Generate a new version of this image using the extracted settings' },
    { label: 'Different prompt, same settings', prompt: 'Use these generation settings but with a different prompt' },
    { label: 'What model was used?', prompt: 'What model was used to generate this?' },
  ],
  resolve_personas: [
    { label: 'As a superhero', prompt: 'Reimagine them as a superhero with cinematic lighting and an action-ready pose' },
    { label: 'As a famous painting', prompt: 'Paint them into a famous masterpiece — Renaissance, Impressionist, or Baroque style' },
    { label: 'Create a portrait', prompt: 'Create a stunning portrait of them' },
    { label: 'Animate into a video', prompt: 'Animate them into a video' },
  ],
  manage_memory: [
    { label: 'Show my preferences', prompt: 'What preferences do you remember about me?' },
    { label: 'Generate an image', prompt: 'Generate an image using my preferences' },
  ],
  dance_montage: [
    { label: 'Try a different dance', prompt: 'Try a different dance style' },
    { label: 'Make it longer', prompt: 'Make the dance video longer' },
    { label: 'Try with another photo', prompt: 'Try the dance with a different photo' },
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

/** Patterns indicating the LLM is waiting for user confirmation to generate */
const READY_TO_GENERATE_PATTERNS = [
  'ready to generate',
  'ready to create',
  'ready to proceed',
  'shall i generate',
  'shall i create',
  'shall i proceed',
  'want me to generate',
  'want me to create',
  'want me to proceed',
  'just say "go"',
  "just say 'go'",
  'just say go',
  'say "go"',
  "say 'go'",
  'go ahead and i\'ll',
  'let me know when you\'re ready',
  'let me know if you\'d like me to generate',
  'let me know if you\'d like to proceed',
  'want to proceed',
  'should i go ahead',
];

/** Detect the creative topic from message history */
function detectTopic(messages: UIChatMessage[]): 'image' | 'video' | 'music' | 'dance' | null {
  const allText = messages.map((m) => m.content || '').join(' ').toLowerCase();
  if (/\b(dance|dancing|choreography)\b/.test(allText) || /\b(rasputin|jellyfish jam)\b/.test(allText) || /dance_montage/.test(allText)) return 'dance';
  if (/\b(song|music|compose|melody|soundtrack|lyrics|beat|bpm|tempo)\b/.test(allText)) return 'music';
  if (/\b(video|animate|animation|clip|motion)\b/.test(allText)) return 'video';
  if (/\b(image|photo|picture|illustration|painting|drawing|portrait)\b/.test(allText)) return 'image';
  return null;
}

/** Generate contextual suggestions for mid-conversation states (no tool completed yet) */
function getMidConversationSuggestions(messages: UIChatMessage[]): Suggestion[] | null {
  // Need at least a user message + assistant response beyond welcome
  const nonWelcome = messages.filter((m) => m.id !== 'welcome');
  if (nonWelcome.length < 2) return null;

  // Find the last assistant message with content
  const lastAssistant = [...nonWelcome].reverse().find(
    (m) => m.role === 'assistant' && m.content?.trim(),
  );
  if (!lastAssistant) return null;

  const text = lastAssistant.content.toLowerCase();

  // Detect ready-to-generate state
  const isReady = READY_TO_GENERATE_PATTERNS.some((p) => text.includes(p));
  if (isReady) {
    const topic = detectTopic(nonWelcome);
    const suggestions: Suggestion[] = [
      { label: 'Generate this', prompt: 'Go ahead and generate it' },
      { label: 'Tweak the prompt', prompt: 'Can you adjust the prompt a bit?' },
    ];
    if (topic === 'image') {
      suggestions.push({ label: 'Try a different style', prompt: 'Try it in a different art style' });
    } else if (topic === 'video') {
      suggestions.push({ label: 'Different motion style', prompt: 'Try a different motion or animation style' });
    } else if (topic === 'music') {
      suggestions.push({ label: 'Different genre', prompt: 'Try a different musical genre' });
    } else {
      suggestions.push({ label: 'Start over', prompt: "Let's try something completely different" });
    }
    return suggestions;
  }

  // Detect ongoing conversation about a specific topic (LLM asking questions)
  const topic = detectTopic(nonWelcome);
  if (topic) {
    if (topic === 'dance') {
      return [
        { label: 'SpongeBob dance', prompt: 'Make them do the SpongeBob Jellyfish Jam dance' },
        { label: 'Rasputin dance', prompt: 'Make them dance to Rasputin' },
        { label: 'Chanel dance', prompt: 'Make them do the Chanel dance' },
        { label: 'This Is America', prompt: 'Make them do the This Is America dance' },
      ];
    }
    if (topic === 'image') {
      return [
        { label: 'Famous painting', prompt: 'Make it look like a famous painting — think Klimt, Frida Kahlo, or Hokusai' },
        { label: 'Comic book hero', prompt: 'Transform it into a Marvel comic book style with bold lines and dramatic action' },
        { label: 'Anime character', prompt: 'Transform it into a Studio Ghibli anime character' },
        { label: 'Surprise me', prompt: 'Surprise me with something creative and unexpected' },
      ];
    }
    if (topic === 'video') {
      return [
        { label: 'Cinematic look', prompt: 'Make it cinematic with dramatic camera movement' },
        { label: 'With dialogue', prompt: 'Have the subject speak with natural dialogue' },
        { label: 'Smooth ambient motion', prompt: 'Use smooth, flowing motion with ambient sounds' },
        { label: 'Surprise me', prompt: 'Surprise me with something creative' },
      ];
    }
    if (topic === 'music') {
      return [
        { label: 'Upbeat pop', prompt: 'Make it upbeat pop' },
        { label: 'Chill lo-fi', prompt: 'Go for a chill lo-fi vibe' },
        { label: 'Epic orchestral', prompt: 'Make it epic and orchestral' },
        { label: 'Surprise me', prompt: 'Surprise me with something creative' },
      ];
    }
  }

  return null;
}

export function generateSuggestions(
  messages: UIChatMessage[],
  analysisSuggestions?: Suggestion[],
  hasImage?: boolean,
  hasPersonas?: boolean,
  hasAudio?: boolean,
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

  // Mid-conversation: detect context and show relevant suggestions
  const midConversation = getMidConversationSuggestions(messages);
  if (midConversation) return midConversation;

  // Fallback: show contextual suggestions based on what files are uploaded
  if (messages.length > 0 && messages[0].role === 'assistant') {
    if (hasAudio && hasImage) return AUDIO_IMAGE_UPLOAD_SUGGESTIONS;
    if (hasAudio) return AUDIO_UPLOAD_SUGGESTIONS;
    if (hasImage) return WELCOME_SUGGESTIONS;
    if (hasPersonas === false) return NO_PERSONAS_SUGGESTIONS;
    return NO_IMAGE_SUGGESTIONS;
  }

  if (hasAudio && hasImage) return AUDIO_IMAGE_UPLOAD_SUGGESTIONS;
  if (hasAudio) return AUDIO_UPLOAD_SUGGESTIONS;
  if (hasImage === false) {
    return hasPersonas === false ? NO_PERSONAS_SUGGESTIONS : NO_IMAGE_SUGGESTIONS;
  }
  return [];
}
