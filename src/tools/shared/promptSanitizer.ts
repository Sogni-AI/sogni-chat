/**
 * Prompt sanitizer for batch variation generation.
 *
 * Image models (especially Qwen Image Edit) interpret certain phrases as
 * instructions to render grids/collages/montages inside a single output.
 * This strips those patterns so each output is always a single image.
 */

/**
 * Phrases that cause models to generate grids or collages.
 * Each regex is applied case-insensitively with word boundaries.
 */
const GRID_PATTERNS: RegExp[] = [
  // Multiplicity adjectives + nouns
  /\b(?:different|various|varying|multiple|several|many|diverse|assorted|range of|variety of|array of|series of|set of|collection of)\s+(?:facial\s+)?(?:expressions?|poses?|angles?|versions?|variations?|looks?|smiles?|moods?|emotions?|faces?|views?|shots?|styles?|options?|takes?)\b/gi,
  // Count + nouns (e.g. "8 different expressions", "9 versions")
  /\b\d+\s+(?:different|unique|distinct|varying|varied)?\s*(?:facial\s+)?(?:expressions?|poses?|angles?|versions?|variations?|looks?|smiles?|moods?|emotions?|faces?|views?|shots?|styles?|options?|takes?|images?|photos?|pictures?|portraits?)\b/gi,
  // Grid/collage/montage layout language
  /\b(?:grid|collage|montage|triptych|diptych|side[- ]by[- ]side|side[- ]to[- ]side|split[- ]?screen|photo[- ]?sheet|contact[- ]?sheet|mood[- ]?board|comparison|lineup|line[- ]?up)\b/gi,
  // "each with/showing/featuring different..."
  /\beach\s+(?:with|showing|featuring|displaying|having)\s+(?:a\s+)?(?:different|unique|distinct)\b/gi,
  // "show/display/create multiple/different..."
  /\b(?:show|display|create|generate|make|render|produce)\s+(?:multiple|different|various|several)\b/gi,
  // "switching up" / "switch up" (causes multi-face grids)
  /\b(?:switch(?:ing)?|mix(?:ing)?)\s+up\b/gi,
];

/**
 * Strip grid/collage-causing language from a prompt.
 * Safe to call on any prompt — only strips patterns that provoke multi-image
 * layouts within a single output.
 */
export function sanitizeBatchPrompt(prompt: string): string {
  let cleaned = prompt;
  for (const pattern of GRID_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, '');
  }
  // Collapse multiple spaces and trim
  cleaned = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1').trim();
  // Remove leading/trailing commas or periods left by stripping
  cleaned = cleaned.replace(/^[,.\s]+/, '').replace(/[,.\s]+$/, '').trim();
  return cleaned;
}
