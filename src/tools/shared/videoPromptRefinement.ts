/**
 * Creative video prompt refinement shared across video tool handlers.
 *
 * When the LLM-generated prompt contains dialogue, character references,
 * narrative elements, or is too shallow for the requested duration, a
 * thinking-mode LLM sub-call expands it into a detailed, production-quality
 * video prompt with actual dialogue, scene staging, and sensory detail.
 *
 * Used by: generate-video, animate-photo
 */

import type { SogniClient } from '@sogni-ai/sogni-client';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { TokenType } from '@/types/wallet';
import { stripThinkBlocks } from './llmHelpers';
import { CHAT_MODEL } from '@/config/chat';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a prompt needs creative expansion via a thinking-mode LLM call.
 *
 * Triggers on:
 * - Dialogue or conversational elements (quoted text of 10+ chars, speech verbs)
 * - Named characters or references to specific people/media (co-occurring with interaction cues)
 * - Narrative/story structure ("argument about", "fight between", etc.)
 * - Interaction between multiple subjects
 * - Short prompts for long videos (shallow intent that needs expansion)
 */
export function needsCreativeRefinement(prompt: string, duration: number): boolean {
  const lower = prompt.toLowerCase();

  // Dialogue indicators — quoted text (10+ chars to avoid false positives like
  // signs reading "OPEN") or speech verbs
  const hasDialogue = /["'].{10,}["']/.test(prompt)
    || /\b(says?|said|argues?|tells?|asks?|responds?|replies|shouts?|whispers?|exclaims?|yells?|screams?|speaks?|talks?|conversation|dialogue|monologue)\b/.test(lower);

  // Character/narrative references — require co-occurrence with an interaction cue
  // to avoid false positives like "a knight chess piece" or "a detective novel"
  const characterWords = /\b(from\s+(the\s+)?(movie|film|show|series|book|game|anime))\b/.test(lower)
    || /\b(character|protagonist|antagonist|hitman|hitmen)\b/.test(lower);
  const interactionCue = /\b(says?|argues?|fights?|talks?|confronts?|meets?|chases?|battles?|debates?|shoots?|they|each\s+other|together|between)\b/.test(lower);
  const hasCharacterRefs = characterWords && interactionCue;

  // Narrative structure — story-like pacing cues (require conjunction)
  const hasNarrative = /\b(argument|fight|battle|chase|confrontation|debate|duel|encounter|sketch|skit)\b/.test(lower)
    && /\b(about|over|regarding|between)\b/.test(lower);

  // Interaction between multiple subjects
  const hasInteraction = /\b(they\s+(both|all|each)|each\s+other|one\s+another)\b/.test(lower)
    || /\b(should\s+(both|all|then|start|begin))\b/.test(lower);

  // Short prompt for a long video — likely needs expansion
  // Threshold: 15 chars per second of video. A 15s video with < 225 chars is shallow.
  const isTooShallow = duration > 8 && prompt.length < duration * 15;

  return hasDialogue || hasCharacterRefs || hasNarrative || hasInteraction || isTooShallow;
}

// ---------------------------------------------------------------------------
// Dialogue duration estimation
// ---------------------------------------------------------------------------

/** Words per second for cinematic dialogue delivery (slower pace with room for pauses) */
const WORDS_PER_SECOND = 2.5;

/** Seconds added per acting beat between dialogue lines */
const BEAT_BUFFER_SECONDS = 1.0;

/** Patterns that indicate an acting beat between dialogue segments */
const BEAT_PATTERNS = /\b(pauses?|looks?\s+(?:away|down|up|back)|glances?\s+(?:away|down|up|back)|takes?\s+a\s+breath|exhales?|inhales?|swallows?|blinks?|sighs?|hesitates?|trails?\s+off|shifts?|turns?\s+(?:away|back|around)|leans?\s+(?:in|back|forward)|nods?|shakes?\s+(?:head|their\s+head)|tilts?\s+(?:head|their\s+head)|clenches?\s+(?:jaw|fist)|tightens?|narrows?\s+(?:eyes|their\s+eyes))\b/gi;

interface DialogueDurationEstimate {
  totalWords: number;
  beatCount: number;
  requiredSeconds: number;
  dialogueSegments: string[];
}

/**
 * Extract quoted dialogue from a prompt and estimate how long it takes to deliver.
 * Returns word count, beat count, and required duration in seconds.
 */
export function estimateDialogueDuration(prompt: string): DialogueDurationEstimate {
  // Extract all double-quoted strings (the standard dialogue format in video prompts)
  const dialogueSegments: string[] = [];
  const quoteRegex = /"([^"]{2,})"/g;
  let match;
  while ((match = quoteRegex.exec(prompt)) !== null) {
    dialogueSegments.push(match[1]);
  }

  if (dialogueSegments.length === 0) {
    return { totalWords: 0, beatCount: 0, requiredSeconds: 0, dialogueSegments: [] };
  }

  const totalWords = dialogueSegments.reduce((sum, seg) => sum + seg.split(/\s+/).filter(Boolean).length, 0);

  // Count acting beats in the text between dialogue segments
  const beatMatches = prompt.match(BEAT_PATTERNS);
  const beatCount = beatMatches ? beatMatches.length : 0;

  const requiredSeconds = (totalWords / WORDS_PER_SECOND) + (beatCount * BEAT_BUFFER_SECONDS);

  return { totalWords, beatCount, requiredSeconds, dialogueSegments };
}


// ---------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------

/**
 * Use a thinking-mode LLM sub-call to expand a shallow or intent-level prompt
 * into a detailed, production-quality video prompt.
 *
 * Handles:
 * - Expanding summarized dialogue into actual spoken lines
 * - Describing characters by appearance (video models don't know names)
 * - Adding scene staging, lighting, camera, and audio direction
 * - Pacing action appropriately for the video duration
 *
 * @param logPrefix - Console log prefix, e.g. "[GENERATE VIDEO]" or "[ANIMATE]"
 */
export interface RefinementResult {
  refinedPrompt: string;
  suggestedDuration?: number;
}

export async function refineVideoPrompt(
  sogniClient: SogniClient,
  prompt: string,
  duration: number,
  tokenType: TokenType,
  logPrefix = '[VIDEO]',
  signal?: AbortSignal,
  /** When true, skip subject/environment expansion — a scene description from the source image is prepended separately. */
  isI2V = false,
  /** Vision-generated scene description of the source image (I2V only). Passed so the refinement LLM can anchor character names to visible details. */
  sceneDescription = '',
  /** Whether the LLM explicitly passed a duration arg (vs. handler default). Controls extend-vs-trim behavior. */
  explicitDuration = false,
): Promise<RefinementResult> {
  if (signal?.aborted) {
    console.log('[VIDEO REFINEMENT] Skipping refinement — signal already aborted');
    return { refinedPrompt: prompt };
  }

  try {
    console.log(`${logPrefix} Refining prompt with thinking mode (${duration}s video, ${prompt.length} chars)`);

    // I2V mode: subject/environment come from a separate vision description prepended
    // to the final prompt, so refinement should focus on motion, dialogue, camera, audio.
    const t2vStructure = `PROMPT STRUCTURE — follow this order:
1. SHOT/STYLE: Open with shot type and visual style (e.g. "Medium close-up, handheld tracking shot", "Wide establishing shot, film noir style").
2. SUBJECT: Age, clothing, hairstyle, build, distinguishing details. The video model does not recognize names — describe APPEARANCE for any referenced characters.
3. ENVIRONMENT & LIGHTING: Location, time of day, light sources, color palette, textures, atmosphere (fog, rain, reflections, dust, smoke).
4. ACTION: What happens beat by beat in chronological order. Temporal connectors: "begins by...", "then...", "as this happens...", "after a beat...". For ${duration} seconds, pace action to fill the duration naturally. Show emotion through visible behavior — not "she is sad", instead "she looks down, pauses, and her voice cracks".
5. CAMERA: Movement relative to the subject — tracking shot, dolly in, handheld follow, slow arc, pan, tilt, static frame, over-the-shoulder.
6. AUDIO & DIALOGUE: Voice quality, room tone, ambience, music, weather, crowd noise, footsteps. Include language or accent if relevant. For speech, write ACTUAL DIALOGUE in double quotes. Break long speech into short quoted phrases with acting beats between them.`;

    const i2vStructure = `This is an IMAGE-TO-VIDEO prompt. A separate scene description of the source image will be prepended — do NOT describe the subject's appearance or environment. Focus entirely on what CHANGES:

PROMPT STRUCTURE — follow this order:
1. SHOT/STYLE: Shot type only (e.g. "Medium close-up, handheld tracking shot").
2. ACTION: The transition from stillness — what moves first, what happens next, beat by beat in chronological order. Temporal connectors: "begins by...", "then...", "as this happens...", "after a beat...". For ${duration} seconds, pace action to fill the duration naturally. Show emotion through visible behavior — not "she is sad", instead "she looks down, pauses, and her voice cracks".
3. CAMERA: Movement relative to the subject — tracking shot, dolly in, handheld follow, slow arc, pan, tilt, static frame, over-the-shoulder.
4. AUDIO & DIALOGUE: Voice quality, room tone, ambience, music, weather, crowd noise, footsteps. Include language or accent if relevant. For speech, write ACTUAL DIALOGUE in double quotes. Break long speech into short quoted phrases with acting beats between them.

NAMES: If the input uses character names, anchor each name on first mention using visible details from the scene description below — gender, approximate age, position, clothing, or a distinguishing feature. Example: "Mark, the young man on the left in the blue shirt" or "Sarah, the woman with dark hair on the right." The video model cannot identify people by name alone. After anchoring, use names freely for dialogue and action attribution.`;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a cinematographer writing shot descriptions for an AI video generation model (LTX 2.3). Expand the user's concept into one detailed, flowing paragraph — a production-quality video prompt.

${isI2V ? i2vStructure : t2vStructure}

DIALOGUE PATTERN: A [character description] speaks in a [voice quality] voice, "[short line]." He/she [physical acting beat]. "[next short line]." Camera [movement]. Audio is [room tone / ambience].

WHAT WORKS WELL: Cinematic compositions, clear camera language, atmosphere (fog, rain, mist, reflections), strong single-subject performances, stylized looks (noir, analog, painterly, fashion editorial, pixel animation), lighting control (rim light, backlight, flicker, golden hour), speech and singing including multiple languages.

COMMON FAILURES TO AVOID:
- Too vague ("A nice video of nature")
- Too short for duration (tiny prompt for ${duration}s video)
- Too numerical (exact angles, counts, speeds, rigid measurements)
- Contradictory (peaceful still lake plus violent crashing waves)
- Too crowded (too many characters, actions, and lighting ideas at once)
- Conflicting lighting logic
- Abstract emotions with no visible physical cues
- Readable text or logos as key requirements

RULES:
- One flowing paragraph, present tense, positive phrasing.
- Close-ups need more detail than wide shots.
- Match prompt length to video duration — ${duration}s needs proportional detail.

USEFUL VOCABULARY — camera: tracking shot, handheld, dolly in, pan, tilt, overhead, over-the-shoulder, static frame, wide establishing shot. Lighting: golden hour, neon glow, flickering candlelight, dramatic shadows, shallow depth of field, film grain, lens flare, rim light. Atmosphere: fog, dust, smoke, rain, particles, reflections. Style: film noir, painterly, comic book, cyberpunk, 8-bit pixel, documentary, arthouse, fashion editorial.

Return ONLY the refined prompt. No explanation, no commentary, no preamble.`,
      },
      {
        role: 'user',
        content: isI2V && sceneDescription
          ? `Scene description of the source image (for anchoring names to visible details — do NOT repeat this in your output):\n${sceneDescription}\n\nExpand this into a detailed ${duration}-second video prompt:\n\n${prompt}`
          : `Expand this into a detailed ${duration}-second video prompt:\n\n${prompt}`,
      },
    ];

    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      stream: true,
      tokenType,
      temperature: 0.7,
      max_tokens: 8192,
      think: true,
    });

    let refined = '';
    let insideThink = false;
    let insideToolCall = false;
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      if (chunk.content) {
        const { cleaned, insideThink: stillThink, insideToolCall: stillToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
        insideThink = stillThink;
        insideToolCall = stillToolCall;
        if (cleaned) refined += cleaned;
      }
    }

    refined = refined.trim();
    if (refined.length <= 50) {
      console.warn(`${logPrefix} Refinement too short (${refined.length} chars), using original`);
      return { refinedPrompt: prompt };
    }

    console.log(`${logPrefix} Prompt refined (${refined.length} chars):`, refined);

    // Post-refinement dialogue duration validation
    return validateDialogueDuration(
      sogniClient, refined, duration, tokenType, logPrefix, signal, explicitDuration,
    );
  } catch (err) {
    console.error(`${logPrefix} Prompt refinement failed, using original:`, err);
    return { refinedPrompt: prompt };
  }
}

// ---------------------------------------------------------------------------
// Post-refinement dialogue duration validation
// ---------------------------------------------------------------------------

/**
 * After refinement, check if dialogue fits within the clip duration.
 * - If dialogue fits: return as-is.
 * - If duration is flexible (default was used): extend duration up to 20s.
 * - If duration is explicit or dialogue exceeds 20s: trim dialogue via LLM.
 */
async function validateDialogueDuration(
  sogniClient: SogniClient,
  refinedPrompt: string,
  duration: number,
  tokenType: TokenType,
  logPrefix: string,
  signal?: AbortSignal,
  explicitDuration = false,
): Promise<RefinementResult> {
  const estimate = estimateDialogueDuration(refinedPrompt);

  if (estimate.totalWords === 0) {
    console.log(`${logPrefix} No dialogue detected — no duration adjustment needed`);
    return { refinedPrompt };
  }

  console.log(`${logPrefix} Dialogue estimated at ${estimate.requiredSeconds.toFixed(1)}s for ${duration}s clip (${estimate.totalWords} words, ${estimate.beatCount} beats)`);

  // Dialogue fits within the clip duration
  if (estimate.requiredSeconds <= duration) {
    console.log(`${logPrefix} Dialogue fits within ${duration}s clip — no adjustment needed`);
    return { refinedPrompt };
  }

  // Duration is flexible (LLM used default) — extend it
  if (!explicitDuration) {
    const suggestedDuration = Math.min(Math.ceil(estimate.requiredSeconds), 20);
    if (suggestedDuration <= 20 && estimate.requiredSeconds <= 20) {
      console.log(`${logPrefix} Extending duration from ${duration}s to ${suggestedDuration}s (default duration, flexible)`);
      return { refinedPrompt, suggestedDuration };
    }
    // Falls through to trimming if dialogue exceeds 20s even after extension
  }

  // Duration is explicit OR dialogue exceeds 20s cap — trim dialogue via LLM
  console.log(`${logPrefix} Trimming dialogue to fit ${explicitDuration ? duration : 20}s clip (${explicitDuration ? 'explicit duration' : 'exceeds 20s cap'})`);

  const targetDuration = explicitDuration ? duration : 20;
  const maxWords = Math.floor(targetDuration * WORDS_PER_SECOND);

  try {
    const trimMessages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are editing a video prompt to fit a time constraint. The dialogue in this prompt requires ~${estimate.requiredSeconds.toFixed(1)} seconds but the clip is only ${targetDuration} seconds. Condense the quoted dialogue to fit within ${targetDuration}s at 2.5 words/second (~${maxWords} words max across all dialogue). Preserve meaning, keep acting beats minimal, and maintain the prompt structure. Return ONLY the revised prompt. No explanation.`,
      },
      {
        role: 'user',
        content: refinedPrompt,
      },
    ];

    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages: trimMessages,
      stream: true,
      tokenType,
      temperature: 0.5,
      max_tokens: 8192,
      think: true,
    });

    let trimmed = '';
    let insideThink = false;
    let insideToolCall = false;
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      if (chunk.content) {
        const { cleaned, insideThink: stillThink, insideToolCall: stillToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
        insideThink = stillThink;
        insideToolCall = stillToolCall;
        if (cleaned) trimmed += cleaned;
      }
    }

    trimmed = trimmed.trim();
    if (trimmed.length > 50) {
      const postTrimEstimate = estimateDialogueDuration(trimmed);
      console.log(`${logPrefix} Post-trim dialogue: ${postTrimEstimate.requiredSeconds.toFixed(1)}s (${postTrimEstimate.totalWords} words, ${postTrimEstimate.beatCount} beats)`);
      return {
        refinedPrompt: trimmed,
        ...(!explicitDuration ? { suggestedDuration: 20 } : {}),
      };
    }

    console.warn(`${logPrefix} Dialogue trim too short (${trimmed.length} chars), using original refined prompt`);
    return {
      refinedPrompt,
      ...(!explicitDuration ? { suggestedDuration: Math.min(Math.ceil(estimate.requiredSeconds), 20) } : {}),
    };
  } catch (err) {
    console.error(`${logPrefix} Dialogue trimming failed, using original refined prompt:`, err);
    return {
      refinedPrompt,
      ...(!explicitDuration ? { suggestedDuration: Math.min(Math.ceil(estimate.requiredSeconds), 20) } : {}),
    };
  }
}
