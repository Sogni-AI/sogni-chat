/**
 * Shared aspect ratio parameter description for all tools that accept
 * an aspectRatio argument. Embedded in tool parameter descriptions so
 * the LLM has contextual guidance when deciding to set (or omit) the value.
 */

export const ASPECT_RATIO_DESCRIPTION = `Do NOT set unless the user explicitly requests an aspect ratio, format, or resolution. Omit to preserve source ratio.

Formats: "16:9", "9:16", "4:5", "1:1", "4:3", "3:2", "21:9", or exact pixels like "1920x1080".

Mappings: landscape/widescreen/YouTube/cinematic → "16:9". portrait/TikTok/Reels → "9:16". ultrawide/cinema scope → "21:9". Instagram post → "4:5". square → "1:1". standard/TV → "4:3". 4K landscape → "3840x2160". 4K portrait → "2160x3840". HD portrait → "1080x1920". HD landscape → "1920x1080". Never set for generic requests like "make a video".`;
