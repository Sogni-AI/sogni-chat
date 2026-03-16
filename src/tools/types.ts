/**
 * Core type definitions for the tool registry system.
 *
 * Each tool is a self-contained module that implements the ToolHandler interface.
 * The registry manages discovery, definition export (for the LLM), and dispatch.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import type { SogniClient } from '@sogni-ai/sogni-client';
import type { TokenType, Balances } from '@/types/wallet';

// ---------------------------------------------------------------------------
// Uploaded files
// ---------------------------------------------------------------------------

/** File uploaded by user (image, audio, or video) */
export interface UploadedFile {
  type: 'image' | 'audio' | 'video';
  data: Uint8Array;
  width?: number;
  height?: number;
  mimeType: string;
  filename: string;
  /** Duration in seconds (for audio/video) */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Tool execution context
// ---------------------------------------------------------------------------

/** Context available to every tool handler during execution */
export interface ToolExecutionContext {
  sogniClient: SogniClient;
  /** Primary image data (from upload) */
  imageData: Uint8Array | null;
  width: number;
  height: number;
  /** Additional uploaded files (audio, video, extra images) */
  uploadedFiles: UploadedFile[];
  tokenType: TokenType;
  /** URLs of previously generated results in this session */
  resultUrls: string[];
  /** Current wallet balances for auto-switch logic */
  balances: Balances | null;
  /** Default quality tier set by the UI toggle */
  qualityTier?: 'fast' | 'hq';
  /** Called when token type is auto-switched due to insufficient balance */
  onTokenSwitch?: (newType: TokenType) => void;
  /** Called when both token types are exhausted */
  onInsufficientCredits?: () => void;
  /** AbortSignal for cancelling in-progress tool executions */
  signal?: AbortSignal;
  /** Override the LLM model (e.g. for abliterated fallback) */
  model?: string;
  /** Override the think parameter (true = extended thinking, false = disabled, undefined = default) */
  think?: boolean;
  /** Whether the safe content filter is enabled (true = filter on, false = filter off). Default: true. */
  safeContentFilter?: boolean;
  /** Called when the content filter setting is changed (e.g. by the set_content_filter tool) */
  onContentFilterChange?: (enabled: boolean) => void;
}

// ---------------------------------------------------------------------------
// Tool names
// ---------------------------------------------------------------------------

/** Tool name union — expanded from original 5 to 14 tools */
export type ToolName =
  | 'restore_photo'
  | 'apply_style'
  | 'refine_result'
  | 'animate_photo'
  | 'change_angle'
  | 'generate_image'
  | 'edit_image'
  | 'generate_video'
  | 'sound_to_video'
  | 'video_to_video'
  | 'generate_music'
  | 'analyze_image'
  | 'set_content_filter'
  | 'extract_metadata';

// ---------------------------------------------------------------------------
// Progress & callbacks
// ---------------------------------------------------------------------------

/** Progress callback from tool execution */
export interface ToolExecutionProgress {
  type: 'started' | 'progress' | 'completed' | 'error';
  toolName: ToolName;
  progress?: number;
  completedCount?: number;
  totalCount?: number;
  resultUrls?: string[];
  /** Video result URLs (separate from image results for UI rendering) */
  videoResultUrls?: string[];
  error?: string;
  jobIndex?: number;
  etaSeconds?: number;
  /** Estimated credit cost for this operation */
  estimatedCost?: number;
  /** URL of the source image being processed (for placeholder display) */
  sourceImageUrl?: string;
  /** Sub-step label shown during multi-phase operations (e.g. "Analyzing image...") */
  stepLabel?: string;
  /** Target video aspect ratio as "w / h" CSS string (e.g. "9 / 16") for preloader sizing */
  videoAspectRatio?: string;
  /** Display name of the AI model used (e.g. "Z-Image Turbo", "LTX-2") */
  modelName?: string;
  /** Accumulated per-job progress for multi-job operations (keyed by jobIndex) */
  perJobProgress?: Record<number, {
    progress?: number;
    etaSeconds?: number;
    resultUrl?: string;
    error?: string;
  }>;
}

/** Callbacks for tool execution — subset of ChatStreamCallbacks */
export interface ToolCallbacks {
  onToolProgress: (progress: ToolExecutionProgress) => void;
  onToolComplete: (toolName: ToolName, resultUrls: string[], videoResultUrls?: string[]) => void;
  onInsufficientCredits?: () => void;
  onGallerySaved?: (galleryImageIds: string[], galleryVideoIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

/** Suggestion chip shown after tool completion */
export interface ToolSuggestion {
  label: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Tool handler interface
// ---------------------------------------------------------------------------

/** A tool handler that can be registered with the ToolRegistry */
export interface ToolHandler {
  /** OpenAI-format tool definition (passed to the LLM) */
  definition: ToolDefinition;
  /** Execute the tool and return a JSON string result for the LLM */
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    callbacks: ToolCallbacks,
  ): Promise<string>;
  /** Optional suggestion chips to show after this tool completes */
  suggestions?: ToolSuggestion[];
}
