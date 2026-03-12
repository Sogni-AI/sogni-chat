/**
 * Shared aspect ratio parameter description for all tools that accept
 * an aspectRatio argument. Embedded in tool parameter descriptions so
 * the LLM has contextual guidance when deciding to set (or omit) the value.
 */

export const ASPECT_RATIO_DESCRIPTION = `IMPORTANT: Do NOT set this parameter unless the user explicitly asks for a specific aspect ratio, format, or resolution. By default, the video MUST match the source image's original aspect ratio. Omit this parameter to preserve the source ratio.

Only set when the user says words like "16:9", "portrait", "landscape", "widescreen", "square", "TikTok", "Instagram", or specifies exact dimensions. If the user just says "make a video" or "animate this", do NOT set aspectRatio.

Supported formats when explicitly requested:
- Ratio: "16:9", "9:16", "4:5", "1:1", "4:3", "3:2", "21:9"
- Exact pixels: "1920x1080", "1080x1920", "720x720"

Map explicit user requests:
- "landscape", "widescreen", "YouTube", "cinematic" → "16:9"
- "portrait", "mobile portrait", "TikTok", "Instagram Reel", "Reels" → "9:16"
- "cinema scope", "ultrawide" → "21:9"
- "Instagram post" → "4:5"
- "square", "Instagram square" → "1:1"
- "standard", "TV", "4:3" → "4:3"
- Exact sizes like "1920x1080", "1080p landscape" → "1920x1080"
- "4K landscape" → "3840x2160", "4K portrait" → "2160x3840"
- "HD portrait" → "1080x1920", "HD landscape" → "1920x1080"`;
