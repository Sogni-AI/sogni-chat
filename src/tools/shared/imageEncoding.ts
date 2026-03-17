/**
 * Shared image encoding utilities for tool handlers.
 */

/** Convert a Uint8Array (image bytes) to a base64 data URI for vision calls. */
export function uint8ArrayToDataUri(data: Uint8Array, mimeType = 'image/jpeg'): string {
  // Process in 8KB chunks to avoid call-stack overflow on large images
  // while avoiding O(N) string concatenation of single characters
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 8192) {
    chunks.push(String.fromCharCode(...data.subarray(i, i + 8192)));
  }
  return `data:${mimeType};base64,${btoa(chunks.join(''))}`;
}
