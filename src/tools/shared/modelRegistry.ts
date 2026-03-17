/**
 * Central model registry — maps tool names to their available generation models.
 * Used by the MediaActionsMenu to show alternative model options for retry.
 *
 * Model keys and display names are extracted from each tool handler's model configs.
 * When a handler adds/removes models, update this registry to match.
 */

export interface ModelOption {
  key: string;
  displayName: string;
}

/**
 * Map of tool names to their available generation models.
 * Tools not listed here (or with only 1 model) won't show "Switch Model" in the menu.
 */
const TOOL_MODELS: Record<string, ModelOption[]> = {
  generate_image: [
    { key: 'z-turbo', displayName: 'Z-Image Turbo' },
    { key: 'z-image', displayName: 'Z-Image' },
    { key: 'chroma-v46-flash', displayName: 'Chroma v.46 Flash' },
    { key: 'chroma-detail', displayName: 'Chroma Detail' },
    { key: 'flux1-krea', displayName: 'Flux.1 Krea' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
    { key: 'pony-v7', displayName: 'CyberRealistic Pony v7' },
  ],
  edit_image: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  generate_video: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
  ],
  animate_photo: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
  ],
  sound_to_video: [
    { key: 'wan-s2v', displayName: 'WAN 2.2 S2V' },
    { key: 'ltx23-ia2v', displayName: 'LTX 2.3 Image+Audio' },
    { key: 'ltx23-a2v', displayName: 'LTX 2.3 Audio Only' },
  ],
  generate_music: [
    { key: 'turbo', displayName: 'ACE-Step 1.5 Turbo' },
    { key: 'sft', displayName: 'ACE-Step 1.5 SFT' },
  ],
};

/** Get the model arg key name used by a given tool ("model" or "videoModel") */
export function getModelArgKey(toolName: string): string {
  const videoModelTools = ['generate_video', 'animate_photo', 'sound_to_video'];
  return videoModelTools.includes(toolName) ? 'videoModel' : 'model';
}

/** Get all available models for a tool. Returns empty array if tool has no model options. */
export function getModelOptions(toolName: string): ModelOption[] {
  return TOOL_MODELS[toolName] ?? [];
}

/** Get alternative models (excludes the currently used model). */
export function getAlternativeModels(toolName: string, currentModelKey?: string): ModelOption[] {
  const all = getModelOptions(toolName);
  if (!currentModelKey) return all;
  return all.filter(m => m.key !== currentModelKey);
}
