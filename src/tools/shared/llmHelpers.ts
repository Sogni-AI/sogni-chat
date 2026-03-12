/**
 * LLM sub-call helpers shared across tool handlers.
 *
 * Used by animate-photo (vision description, dialogue refinement) and
 * potentially other tools that make LLM sub-calls during execution.
 */

/** Timeout for LLM sub-calls (image description, dialogue refinement) */
export const LLM_SUBCALL_TIMEOUT_MS = 20_000;

/** Race a promise against a timeout. Returns undefined on timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const raced = Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[LLM HELPERS] ${label} timed out after ${ms}ms`);
        resolve(undefined);
      }, ms);
    }),
  ]);
  // Clear the timer whether the promise resolves or rejects
  raced.finally(() => clearTimeout(timer));
  return raced;
}

/**
 * Strip Qwen `<think>...</think>` blocks from streamed content.
 * Returns the cleaned text and whether we're still inside a think block.
 */
export function stripThinkBlocks(text: string, insideThink: boolean): { cleaned: string; insideThink: boolean } {
  let result = '';
  let inThink = insideThink;
  let i = 0;

  while (i < text.length) {
    if (!inThink) {
      const openIdx = text.indexOf('<think>', i);
      if (openIdx === -1) {
        result += text.slice(i);
        break;
      }
      result += text.slice(i, openIdx);
      inThink = true;
      i = openIdx + 7; // length of '<think>'
    } else {
      const closeIdx = text.indexOf('</think>', i);
      if (closeIdx === -1) {
        // Still inside think block, consume the rest
        break;
      }
      inThink = false;
      i = closeIdx + 8; // length of '</think>'
    }
  }

  return { cleaned: result, insideThink: inThink };
}
