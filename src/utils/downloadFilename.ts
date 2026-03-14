/**
 * Generate contextual download filenames based on the original uploaded file name.
 * Pattern: sogni-chat-{baseName}-{index}.{ext}
 */

/** Strip extension and sanitize a filename for use as a slug */
export function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')       // remove extension
    .replace(/[^a-zA-Z0-9_-]+/g, '-') // replace non-alphanumeric with dashes
    .replace(/-+/g, '-')           // collapse multiple dashes
    .replace(/^-|-$/g, '')         // trim leading/trailing dashes
    .toLowerCase()
    .slice(0, 60);                 // cap length
}

/**
 * Build a download filename for a restored image.
 * @param originalFileName - The original uploaded file's name (e.g. "family-portrait.jpg")
 * @param index - 1-based variation index (omit for single downloads)
 * @param type - 'restored' | 'original' | 'video' | 'styled'
 */
export function buildDownloadFilename(
  originalFileName: string | undefined,
  index?: number,
  type: 'restored' | 'original' | 'video' | 'styled' | 'audio' = 'restored',
): string {
  const slug = originalFileName ? slugify(originalFileName) : (type === 'audio' ? 'music' : 'photo');
  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg';

  const parts = ['sogni'];
  if (type === 'original') {
    parts.push('original');
  } else if (type === 'video') {
    parts.push('video');
  } else if (type === 'audio') {
    parts.push('audio');
  } else if (type === 'styled') {
    parts.push('styled');
  } else {
    parts.push('chat');
  }
  parts.push(slug);
  if (index != null) parts.push(String(index));

  return `${parts.join('-')}.${ext}`;
}

/**
 * Build a zip filename for bulk downloads.
 */
export function buildZipFilename(originalFileName?: string): string {
  const slug = originalFileName ? slugify(originalFileName) : 'photos';
  return `sogni-chat-${slug}.zip`;
}
