/**
 * Chat History Types -- Data models for persisting chat sessions in IndexedDB.
 */

import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { Suggestion } from '@/utils/chatSuggestions';
import type { ToolExecutionProgress, UploadedFile } from '@/tools/types';

/** UI message (extends ChatMessage with display metadata) */
export interface UIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  imageResults?: string[];
  videoResults?: string[];
  audioResults?: string[];
  toolProgress?: ToolExecutionProgress | null;
  isStreaming?: boolean;
  lastCompletedTool?: string;
  uploadedImageUrl?: string;
  /** Multiple uploaded image preview URLs (for multi-image sessions) */
  uploadedImageUrls?: string[];
  sourceImageUrl?: string;
  modelRefusal?: boolean;
  galleryImageIds?: string[];
  galleryVideoIds?: string[];
  videoAspectRatio?: string;
  /** Display name of the AI model used for this result (e.g. "Z-Image Turbo") */
  modelName?: string;
}

/** Full chat session stored in IndexedDB */
export interface ChatSession {
  /** Unique session ID (UUID) */
  id: string;
  /** Session title (first user message or filename) */
  title: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Timestamp when session was last modified */
  updatedAt: number;
  /** UI messages for rendering */
  uiMessages: UIChatMessage[];
  /** LLM conversation history (raw ChatMessages for API) */
  conversation: ChatMessage[];
  /** All result image URLs produced in this session */
  allResultUrls: string[];
  /** Suggestions parsed from vision analysis */
  analysisSuggestions: Suggestion[];
  /** If the session was switched to abliterated model, persist that choice */
  sessionModel?: string;
  /** Attached files (images, audio, video) persisted for session restoration */
  uploadedFiles?: UploadedFile[];
  // Legacy fields — kept for backward compat with sessions saved before unified uploads
  /** @deprecated Use uploadedFiles instead */
  imageData?: Uint8Array;
  /** @deprecated Use uploadedFiles instead */
  width?: number;
  /** @deprecated Use uploadedFiles instead */
  height?: number;
}

/** Lightweight session summary for sidebar list (no heavy data) */
export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Whether this session has an uploaded image */
  hasImage: boolean;
}

/** Thumbnail blob stored separately for efficient sidebar rendering */
export interface ChatSessionThumbnail {
  /** Session ID this thumbnail belongs to */
  sessionId: string;
  /** Thumbnail image blob (small JPEG) */
  blob: Blob;
}
