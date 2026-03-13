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
export async function refineVideoPrompt(
  sogniClient: SogniClient,
  prompt: string,
  duration: number,
  tokenType: TokenType,
  logPrefix = '[VIDEO]',
): Promise<string> {
  try {
    console.log(`${logPrefix} Refining prompt with thinking mode (${duration}s video, ${prompt.length} chars)`);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a video prompt engineer. Expand the user's video concept into a detailed, production-quality prompt for an AI video generation model (LTX 2.3).

CRITICAL RULES:
1. DIALOGUE: If the concept implies conversation, argument, or speech, write out the ACTUAL DIALOGUE in double quotes. Never summarize dialogue — write the exact words each person says. Space dialogue naturally across ${duration} seconds with pauses, gestures, and reactions between lines.

2. CHARACTERS: The video model does not recognize names. If the user references characters from movies, TV, games, or real people, describe their PHYSICAL APPEARANCE in vivid detail (clothing, hair, build, distinguishing features, mannerisms) so the model can generate them visually. Never rely on a name alone.

3. ACTION: Describe what physically happens on screen moment by moment. Use temporal connectors: "begins by...", "then...", "as this happens...", "suddenly...", "after a beat...". For ${duration} seconds of video, pace the action so it fills the duration naturally without feeling rushed or empty.

4. SENSORY DETAIL: Include concrete visual details — lighting direction, color palette, textures, environment. Describe audio: ambient sounds, music style, tone of voice for dialogue. End with camera movement ("slow push-in", "handheld tracking shot", "static wide angle").

5. PRESENT TENSE only. Positive phrasing (describe what IS happening, not what isn't).

6. End with: "The footage remains smooth and stabilised throughout."

Return ONLY the refined prompt. No explanation, no commentary, no preamble.`,
      },
      {
        role: 'user',
        content: `Expand this into a detailed ${duration}-second video prompt:\n\n${prompt}`,
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
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: still } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = still;
        if (cleaned) refined += cleaned;
      }
    }

    refined = refined.trim();
    if (refined.length > 50) {
      console.log(`${logPrefix} Prompt refined (${refined.length} chars):`, refined);
      return refined;
    }

    console.warn(`${logPrefix} Refinement too short (${refined.length} chars), using original`);
    return prompt;
  } catch (err) {
    console.error(`${logPrefix} Prompt refinement failed, using original:`, err);
    return prompt;
  }
}
