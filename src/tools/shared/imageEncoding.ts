/**
 * Shared image encoding utilities for tool handlers.
 */

/** Convert a Uint8Array (image bytes) to a base64 data URI for vision calls. */
export function uint8ArrayToDataUri(data: Uint8Array, mimeType = 'image/jpeg'): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
