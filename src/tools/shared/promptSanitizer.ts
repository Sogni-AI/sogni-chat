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
  /\b(?:different|various|varying|multiple|several|many|diverse|assorted|all|range of|variety of|array of|series of|set of|collection of)\s+(?:facial\s+)?(?:expressions?|poses?|angles?|versions?|variations?|looks?|smiles?|moods?|emotions?|faces?|views?|shots?|styles?|options?|takes?)\b/gi,
  // Count + nouns (e.g. "8 different expressions", "9 versions", "8 separate images")
  /\b\d+\s+(?:different|unique|distinct|varying|varied|separate|individual)?\s*(?:facial\s+)?(?:expressions?|poses?|angles?|versions?|variations?|looks?|smiles?|moods?|emotions?|faces?|views?|shots?|styles?|options?|takes?|images?|photos?|pictures?|portraits?|copies|duplicates)\b/gi,
  // Grid/collage/montage/composite layout language
  /\b(?:grid|collage|montage|composite|triptych|diptych|side[- ]by[- ]side|side[- ]to[- ]side|split[- ]?screen|photo[- ]?sheet|contact[- ]?sheet|mood[- ]?board|lineup|line[- ]?up|tile[ds]?|tiling|rows?\s+(?:of|and)\s+columns?|columns?\s+(?:of|and)\s+rows?)\b/gi,
  // "each with/showing/featuring different..."
  /\beach\s+(?:with|showing|featuring|displaying|having|in)\s+(?:a\s+)?(?:different|unique|distinct|its own)\b/gi,
  // "each one" / "each version" standalone
  /\beach\s+(?:one|version|variation|image|copy)\b/gi,
  // "show/display/create multiple/different..."
  /\b(?:show|display|create|generate|make|render|produce)\s+(?:multiple|different|various|several|all)\b/gi,
  // "switching up" / "switch up" (causes multi-face grids)
  /\b(?:switch(?:ing)?|mix(?:ing)?)\s+up\b/gi,
  // "N of them" / "N of these" (e.g. "give me 8 of them")
  /\b\d+\s+of\s+(?:them|these|those)\b/gi,
  // "multiple copies/duplicates/instances"
  /\b(?:multiple|several|many)\s+(?:copies|duplicates|instances|repeats)\b/gi,
  // Bare "N versions/variations" without adjective (e.g. "8 versions")
  /\b\d+\s+(?:versions?|variations?|renditions?|interpretations?|depictions?|iterations?)\b/gi,
  // "repeated/repeating N times" or "the same X repeated"
  /\b(?:repeated|repeating|repeat)\s+\d*\s*(?:times?)?\b/gi,
  // "put/place them together" / "all together" / "in one image/frame"
  /\b(?:put|place|fit|arrange)\s+(?:them|these|those|it)\s+(?:all\s+)?(?:together|into one|in one)\b/gi,
  /\ball\s+(?:together|in\s+one\s+(?:image|frame|picture|photo))\b/gi,
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
