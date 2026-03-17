/**
 * LLM sub-call helpers shared across tool handlers.
 *
 * Used by animate-photo (vision description, dialogue refinement) and
 * potentially other tools that make LLM sub-calls during execution.
 */

/** Timeout for non-thinking LLM sub-calls (image description, short completions) */
export const LLM_SUBCALL_TIMEOUT_MS = 20_000;

/** Timeout for thinking-mode LLM sub-calls (creative prompt refinement).
 *  Thinking mode needs more time: the model generates a <think> block first. */
export const LLM_THINKING_TIMEOUT_MS = 45_000;

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

/** Strip a specific XML-like tag pair from text, tracking streaming state. */
function stripXmlTag(
  text: string,
  inside: boolean,
  openTag: string,
  closeTag: string,
): { cleaned: string; inside: boolean } {
  let result = '';
  let inTag = inside;
  let i = 0;

  while (i < text.length) {
    if (!inTag) {
      const openIdx = text.indexOf(openTag, i);
      if (openIdx === -1) {
        result += text.slice(i);
        break;
      }
      result += text.slice(i, openIdx);
      inTag = true;
      i = openIdx + openTag.length;
    } else {
      const closeIdx = text.indexOf(closeTag, i);
      if (closeIdx === -1) {
        // Still inside tag, consume the rest
        break;
      }
      inTag = false;
      i = closeIdx + closeTag.length;
    }
  }

  return { cleaned: result, inside: inTag };
}

/**
 * Strip Qwen `<think>...</think>` and leaked `<tool_call>...</tool_call>` blocks
 * from streamed content. Tool call XML leaks when the LLM emits tool calls as
 * text instead of structured JSON — these must never be shown to the user.
 * Returns the cleaned text and state flags for tracking across streamed chunks.
 */
export function stripThinkBlocks(
  text: string,
  insideThink: boolean,
  insideToolCall = false,
): { cleaned: string; insideThink: boolean; insideToolCall: boolean } {
  const thinkResult = stripXmlTag(text, insideThink, '<think>', '</think>');
  const toolCallResult = stripXmlTag(thinkResult.cleaned, insideToolCall, '<tool_call>', '</tool_call>');

  return {
    cleaned: toolCallResult.cleaned,
    insideThink: thinkResult.inside,
    insideToolCall: toolCallResult.inside,
  };
}
