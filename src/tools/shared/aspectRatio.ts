/**
 * Shared aspect ratio parameter description for all tools that accept
 * an aspectRatio argument. Embedded in tool parameter descriptions so
 * the LLM has contextual guidance when deciding to set (or omit) the value.
 */

export const ASPECT_RATIO_DESCRIPTION = `Do NOT set unless the user explicitly requests an aspect ratio, format, or resolution. When the user uploaded an image, default to its aspect ratio (use the dimensions from the [Uploaded images: ...] annotation). Omit to preserve source ratio.

Formats: "16:9", "9:16", "4:5", "1:1", "4:3", "3:2", "21:9", or exact pixels like "1920x1080".

CRITICAL: When the user specifies exact pixel dimensions (e.g., "1080x1920", "1920x1080", "3840x2160"), you MUST use the exact pixel format (e.g., "1080x1920"), NOT a ratio like "9:16". Using a ratio loses the resolution information and produces smaller output. Only use ratio format when the user says a generic format name without pixel dimensions.

Mappings (use ONLY when user does NOT specify pixel dimensions): landscape/widescreen/YouTube/cinematic → "16:9". portrait/TikTok/Reels → "9:16". ultrawide/cinema scope → "21:9". Instagram post → "4:5". square → "1:1". standard/TV → "4:3". 4K landscape → "3840x2160". 4K portrait → "2160x3840". HD portrait → "1080x1920". HD landscape → "1920x1080". Never set for generic requests like "make a video".`;
