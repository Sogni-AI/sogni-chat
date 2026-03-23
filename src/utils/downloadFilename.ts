/**
 * Generate contextual download filenames with metadata.
 * Pattern: sogni-{type}-{topic}-{model}-{WxH}-{extras}-{index}.{ext}
 *
 * Examples:
 *   sogni-video-sunset-drone-shot-ltx23-1920x1088-1.mp4
 *   sogni-chat-family-portrait-flux2-dev-1024x1024-seed42-1.jpg
 *   sogni-audio-upbeat-jazz-sonic-logos-1.mp3
 */

/** Optional metadata to enrich download filenames */
export interface DownloadMetadata {
  /** Model key or display name (e.g. "ltx23", "Flux.2 Dev") */
  model?: string;
  /** Output width in pixels */
  width?: number;
  /** Output height in pixels */
  height?: number;
  /** Frames per second (video) */
  fps?: number;
  /** Generation seed */
  seed?: number | string;
  /** Video duration in seconds */
  duration?: number;
}

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
 * Build a contextual download filename with optional metadata.
 * @param originalFileName - Descriptive slug (e.g. session title, original file name)
 * @param index - 1-based variation index (omit for single downloads)
 * @param type - Media type: 'restored' | 'original' | 'video' | 'styled' | 'audio'
 * @param metadata - Optional generation metadata (model, dimensions, seed, etc.)
 */
export function buildDownloadFilename(
  originalFileName: string | undefined,
  index?: number,
  type: 'restored' | 'original' | 'video' | 'styled' | 'audio' = 'restored',
  metadata?: DownloadMetadata,
): string {
  const defaultSlug = type === 'audio' ? 'music' : type === 'video' ? 'video' : 'photo';
  const slug = originalFileName ? slugify(originalFileName) : defaultSlug;
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

  // Append metadata segments when available
  if (metadata) {
    if (metadata.model) {
      parts.push(slugify(metadata.model));
    }
    if (metadata.width && metadata.height) {
      parts.push(`${metadata.width}x${metadata.height}`);
    }
    if (metadata.duration) {
      parts.push(`${metadata.duration}s`);
    }
    if (metadata.fps) {
      parts.push(`${metadata.fps}fps`);
    }
    if (metadata.seed != null) {
      parts.push(`seed${metadata.seed}`);
    }
  }

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
