/**
 * 3-tier thinking-mode classifier for Auto variant.
 *
 * Tier 1 — HARD ON:  Strong domain signals (scripts, storyboards, multi-scene, etc.)
 * Tier 2 — HARD OFF: Clearly simple tasks (style transfer, describe image, single gen)
 * Tier 3 — SCORED:   Ambiguous leftovers scored by weak signal accumulation
 *
 * Default: thinking OFF.  Only activates for tasks that benefit from structured
 * reasoning — script writing, storyboard/beat-sheet generation, multi-scene
 * continuity, adapting many constraints, or transforming vague briefs into plans.
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface ThinkingDecision {
  mode: 'on' | 'off';
  stage: 'hard_on' | 'hard_off' | 'scored';
  score: number;
  matchedOn: string[];
  matchedOff: string[];
  signals: string[];
}

interface NamedPattern {
  name: string;
  regex: RegExp;
}

interface WeightedPattern {
  name: string;
  regex: RegExp;
  weight: number;
}

// ── Tier 1: Hard ON ─────────────────────────────────────────────────────
// Strong, domain-specific signals that justify thinking on their own.

const HARD_ON_PATTERNS: NamedPattern[] = [
  {
    name: 'script/screenplay/dialogue',
    regex: /\b(?:script|screenplay|dialogue|monologue|voiceover|narration)\b/i,
  },
  {
    name: 'storyboard/beat-sheet/shot-list',
    regex: /\b(?:storyboard|beat\s*sheet|shot\s*list|scene\s*breakdown|treatment|creative\s*brief)\b/i,
  },
  {
    name: 'shot-by-shot / scene-by-scene',
    regex: /\b(?:shot[- ]?by[- ]?shot|scene[- ]?by[- ]?scene|multi[- ]?scene|across\s+scenes?|continuity)\b/i,
  },
  {
    name: 'explicit narrative structure',
    regex: /\b(?:narrative\s+(?:arc|progression|structure)|story\s*(?:arc|structure)|hook\s+and\s+payoff|hook|payoff|reveal)\b/i,
  },
  {
    name: 'transform into structured deliverable',
    regex: /\b(?:turn|transform|convert|adapt|make)\b.{0,60}\b(?:into|to)\b.{0,50}\b(?:script|storyboard|beat\s*sheet|shot\s*list|scene\s*breakdown|treatment|ad|commercial|promo|video)\b/i,
  },
  {
    name: 'plan/outline/breakdown + creative target',
    regex: /\b(?:plan|outline|map\s*out|break\s*down|structure)\b.{0,50}\b(?:video|campaign|commercial|ad|promo|story|series|production)\b/i,
  },
  {
    name: 'explicit scene/beat/shot count',
    regex: /\b(?:\d+\s*(?:beats?|scenes?|acts?|segments?|shots?)|scene\s*1\b|act\s*1\b)\b/i,
  },
  {
    name: 'duration + creative deliverable',
    regex: /\b(?:\d+[- ]?(?:second|seconds|minute|minutes|min|mins|s))\b.{0,40}\b(?:ad|commercial|video|spot|promo|launch|brand\s*story|script)\b/i,
  },
  {
    name: 'shot breakdown phrasing',
    regex: /\b(?:breakdown|sequence|flow|structure)\b.{0,30}\b(?:shot|scene|video|commercial|promo)\b/i,
  },
];

// ── Tier 2: Hard OFF ────────────────────────────────────────────────────
// Bounded/simple tasks that do not benefit from thinking.

const HARD_OFF_PATTERNS: NamedPattern[] = [
  {
    name: 'simple make/generate/create prompt',
    regex: /^\s*(?:make|generate|create)\b.{0,80}\b(?:image|images|video|videos|picture|pictures|photo|photos|prompt|prompts)\b/i,
  },
  {
    name: 'variants/options/examples/ideas/list',
    regex: /\b(?:variants?|options?|examples?|ideas?|list)\b/i,
  },
  {
    name: 'style transfer',
    regex: /\b(?:turn|make|convert|transform)\b.{0,40}\b(?:photo|image|picture)\b.{0,30}\b(?:into|to)\b.{0,30}\b(?:style|anime|cartoon|painting|watercolor|oil\s*painting)\b/i,
  },
  {
    name: 'simple rewrite/tweak',
    regex: /\b(?:rewrite|rephrase|shorten|tweak|improve|make\s+it\s+more)\b/i,
  },
  {
    name: 'describe/analyze image',
    regex: /\b(?:describe|analyze|analyse|what do you see)\b.{0,40}\b(?:image|photo|picture)\b/i,
  },
  {
    name: 'caption/title/tagline only',
    regex: /\b(?:caption|title|tagline|headline)\b/i,
  },
];

// ── Tier 3: Scored fallback ─────────────────────────────────────────────
// Weak signals accumulated when neither hard tier matched.

const POSITIVE_SCORE_PATTERNS: WeightedPattern[] = [
  { name: 'plan/outline/structure language', regex: /\b(?:plan|outline|structure|sequence|flow|arc|coherent)\b/i, weight: 1 },
  { name: 'creative target noun', regex: /\b(?:video|commercial|ad|promo|series|campaign|story)\b/i, weight: 1 },
  { name: 'transformation verb', regex: /\b(?:turn|transform|convert|adapt|map\s*out|break\s*down)\b/i, weight: 1 },
  { name: 'duration mention', regex: /\b(?:\d+[- ]?(?:second|seconds|minute|minutes|min|mins|s))\b/i, weight: 1 },
  { name: 'scene or shot mention', regex: /\b(?:scene|shot|beat|act|segment)\b/i, weight: 1 },
  { name: 'constraint language', regex: /\b(?:must|should|include|ensure|using|with|featuring|maintain|needs\s+to)\b/i, weight: 1 },
];

const NEGATIVE_SCORE_PATTERNS: WeightedPattern[] = [
  { name: 'simple idea/list request', regex: /\b(?:ideas?|examples?|options?|list)\b/i, weight: -1 },
  { name: 'quick/simple phrasing', regex: /\b(?:quick|simple|brief|just)\b/i, weight: -1 },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function countCommas(text: string): number {
  return (text.match(/,/g) || []).length;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Detect a creative brief with 3+ constraints or 3+ comma-separated clauses. */
function hasHeavilyConstrainedBrief(text: string): boolean {
  const hasCreativeTarget = /\b(?:ad|commercial|promo|video|spot|campaign|launch)\b/i.test(text);
  const constraintHits = [
    /\bmust\b/i, /\binclude\b/i, /\bensure\b/i, /\bwith\b/i,
    /\bfeaturing\b/i, /\bend with\b/i, /\bshow\b/i,
  ].reduce((sum, p) => sum + (p.test(text) ? 1 : 0), 0);
  return hasCreativeTarget && (constraintHits >= 3 || countCommas(text) >= 3);
}

function findMatches(text: string, patterns: NamedPattern[]): string[] {
  return patterns.filter((p) => p.regex.test(text)).map((p) => p.name);
}

// ── Main classifier ─────────────────────────────────────────────────────

/**
 * Decide whether extended thinking should be enabled for a user message.
 * Returns a ThinkingDecision with full observability into why.
 */
export function decideThinkingMode(message: string): ThinkingDecision {
  const text = message.trim();

  // Tier 1: Hard ON
  const matchedOn = findMatches(text, HARD_ON_PATTERNS);
  if (matchedOn.length > 0 || hasHeavilyConstrainedBrief(text)) {
    const hardOnMatches = [...matchedOn];
    if (hasHeavilyConstrainedBrief(text)) {
      hardOnMatches.push('heavily constrained creative brief');
    }
    return { mode: 'on', stage: 'hard_on', score: 100, matchedOn: hardOnMatches, matchedOff: [], signals: [] };
  }

  // Tier 2: Hard OFF
  const matchedOff = findMatches(text, HARD_OFF_PATTERNS);
  if (matchedOff.length > 0) {
    return { mode: 'off', stage: 'hard_off', score: -100, matchedOn: [], matchedOff, signals: [] };
  }

  // Tier 3: Scored tie-breaker
  let score = 0;
  const signals: string[] = [];

  for (const p of POSITIVE_SCORE_PATTERNS) {
    if (p.regex.test(text)) { score += p.weight; signals.push(`${p.name} +${p.weight}`); }
  }
  for (const p of NEGATIVE_SCORE_PATTERNS) {
    if (p.regex.test(text)) { score += p.weight; signals.push(`${p.name} ${p.weight}`); }
  }

  if (countCommas(text) >= 3) { score += 1; signals.push('3+ commas +1'); }
  if (wordCount(text) >= 22) { score += 1; signals.push('22+ words +1'); }

  // Threshold intentionally low — this layer only sees ambiguous leftovers.
  const mode = score >= 2 ? 'on' : 'off';
  return { mode, stage: 'scored', score, matchedOn: [], matchedOff: [], signals };
}

/**
 * Simple boolean wrapper for use in useChat — returns true when thinking should be enabled.
 */
export function shouldEnableThinking(message: string): boolean {
  return decideThinkingMode(message).mode === 'on';
}
