/**
 * Type definitions for user data: personas and memories.
 * Stored in IndexedDB (sogni_user_data), separate from chat history.
 */

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** A named person/pet with photo reference for AI-powered creations */
export interface Persona {
  id: string;
  name: string;
  relationship: string; // "self" | "partner" | "child" | "friend" | "pet" | custom string
  description: string;  // Free-text appearance description
  tags: string[];
  /** Photo stored as JPEG, max 1024px longest side */
  photoData: Uint8Array | null;
  photoMimeType: string | null;
  photoWidth: number | null;
  photoHeight: number | null;
  /** Cached AI vision description of the photo */
  visionDescription: string | null;
  /** Cropped reference photo (head-to-waist) for image generation — JPEG Uint8Array */
  referencePhotoData: Uint8Array | null;
  /** Default clothing/attire detected from photo — optional, cleared = scenario-driven */
  defaultAttire: string | null;
  /** Voice description for video/animation generation — accent, tone, pitch */
  voice: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Lightweight persona summary (no photo data) for lists */
export interface PersonaSummary {
  id: string;
  name: string;
  relationship: string;
  description: string;
  tags: string[];
  hasPhoto: boolean;
  /** Voice description — included in summary for system prompt injection */
  voice: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Persona thumbnail stored separately for efficient loading */
export interface PersonaThumbnail {
  personaId: string;
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

/** A persistent user preference or fact */
export interface Memory {
  id: string;
  key: string;           // e.g. "preferred_style"
  value: string;         // e.g. "watercolor and soft lighting"
  category: 'preference' | 'fact' | 'context';
  source: 'user' | 'llm' | 'onboarding';
  createdAt: number;
  updatedAt: number;
}
