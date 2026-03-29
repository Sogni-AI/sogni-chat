/**
 * Slide-out editor panel for creating/editing personas.
 * 340px wide, slides in from left with backdrop blur.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { SogniClient } from '@sogni-ai/sogni-client';
import type { Persona } from '@/types/userData';
import type { TokenType } from '@/types/wallet';
import { sendVisionAnalysis } from '@/services/chatService';
import { resizeUint8ArrayForVision } from '@/utils/imageProcessing';
import { PersonaAvatar } from './PersonaAvatar';
import { VoiceClipManager } from './VoiceClipManager';

const RELATIONSHIPS = ['self', 'partner', 'child', 'friend', 'pet', 'other'];

/** Relationship-aware placeholder examples and help text */
const RELATIONSHIP_HINTS: Record<string, {
  namePlaceholder: string;
  nameHelp: string;
  descPlaceholder: string;
  descHelp: string;
  nickPlaceholder: string;
  nickHelp: string;
  photoTip: string;
}> = {
  self: {
    namePlaceholder: 'e.g. Mark, Sarah',
    nameHelp: 'Your first name — used in chat like "make a picture of me" or "make a picture of Mark"',
    descPlaceholder: 'e.g. Loves hiking, works as a chef, always has a coffee in hand',
    descHelp: 'Optional extra context about personality, hobbies, or backstory. Physical appearance is handled by the AI Description below.',
    nickPlaceholder: 'e.g. bro, dude',
    nickHelp: 'Extra nicknames beyond the basics. "Me" and "myself" are already built-in for the Self relationship.',
    photoTip: 'Adding a photo gives much better results than text descriptions alone.',
  },
  partner: {
    namePlaceholder: 'e.g. Sarah, James',
    nameHelp: 'Their name — used in chat like "make a picture of me and Sarah"',
    descPlaceholder: 'e.g. Marine biologist, obsessed with sushi, always laughing',
    descHelp: 'Optional extra context about who they are — interests, personality, occupation. Physical appearance is handled by the AI Description.',
    nickPlaceholder: 'e.g. babe, honey',
    nickHelp: 'Extra nicknames. "My wife", "my husband", and "my partner" are already built-in for this relationship.',
    photoTip: 'A clear photo helps the AI accurately depict your partner.',
  },
  child: {
    namePlaceholder: 'e.g. Mei, Oliver',
    nameHelp: 'Their name — used in chat like "make a picture of Mei at the park"',
    descPlaceholder: 'e.g. 3 years old, loves dinosaurs, always carrying a stuffed bunny',
    descHelp: 'Optional extra context like age, interests, or personality quirks. Physical appearance is handled by the AI Description.',
    nickPlaceholder: 'e.g. kiddo, little one, bug',
    nickHelp: 'Extra nicknames. "My son", "my daughter", and "my kid" are already built-in for this relationship.',
    photoTip: 'A recent photo works best since kids change quickly.',
  },
  friend: {
    namePlaceholder: 'e.g. Alex, Jordan',
    nameHelp: 'Their name — used in chat like "put Alex and me at a concert"',
    descPlaceholder: 'e.g. DJ on weekends, collects vinyl, never without headphones',
    descHelp: 'Optional extra context — personality, hobbies, or character details. Physical appearance is handled by the AI Description.',
    nickPlaceholder: 'e.g. bestie, roommate',
    nickHelp: 'Other ways you refer to them, so the AI recognizes them by any name.',
    photoTip: 'Adding a photo gives much better results than text descriptions alone.',
  },
  pet: {
    namePlaceholder: 'e.g. Luna, Max, Whiskers',
    nameHelp: 'Your pet\'s name — used in chat like "make a picture of Luna on the beach"',
    descPlaceholder: 'e.g. Golden retriever, loves fetch, afraid of thunder',
    descHelp: 'Optional extra context like breed, personality, or favorite things. Physical appearance is handled by the AI Description.',
    nickPlaceholder: 'e.g. good boy, fluffball, the pup',
    nickHelp: 'Extra nicknames. "My dog", "my cat", and "my pet" are already built-in for this relationship.',
    photoTip: 'A clear photo of your pet helps the AI get breed and markings right.',
  },
  other: {
    namePlaceholder: 'e.g. Grandma Rose, Coach Dan',
    nameHelp: 'The name you\'ll use to reference this person in chat.',
    descPlaceholder: 'e.g. Retired teacher, loves gardening, tells the best stories',
    descHelp: 'Optional extra context — background, personality, or character details. Physical appearance is handled by the AI Description.',
    nickPlaceholder: 'e.g. grandma, nana, coach',
    nickHelp: 'Other ways you might refer to them so the AI recognizes the reference.',
    photoTip: 'Adding a photo gives much better results than text descriptions alone.',
  },
};

function getHints(rel: string) {
  return RELATIONSHIP_HINTS[rel] || RELATIONSHIP_HINTS.other;
}

/** Small "i" help icon that shows a tooltip on hover */
function HelpTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        style={{
          width: '14px', height: '14px', borderRadius: '50%', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700,
          color: '#666', border: '1px solid #555', cursor: 'help', lineHeight: 1,
          flexShrink: 0, userSelect: 'none',
        }}
      >
        i
      </span>
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
          background: '#2f2f2f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)',
          padding: '6px 10px', fontSize: '0.6875rem', color: '#d4d4d4', lineHeight: 1.4,
          width: '220px', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          animation: 'backdropFadeIn 0.1s ease', pointerEvents: 'none',
        }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

const PERSONA_VISION_PROMPT = `Analyze this photo of a person for an AI image generation reference.

Return a JSON object with these fields:
{
  "appearance": "Concise comma-separated physical descriptors optimized for an image generation model (Flux). Use this tag format — Gender: ..., Age: ..., Ethnicity: ..., Skin: ..., Face: ..., Hair: ..., Eyes: ..., Build: ... — Include ONLY permanent physical features. Omit clothing, accessories, pose, expression, and setting. Example: Gender: female, Age: mid-20s, Ethnicity: East Asian, Skin: light warm tone, Face: round with soft features, Hair: short black bob with straight bangs, Eyes: dark brown almond-shaped, Build: slim",
  "attire": "Brief description of clothing/outfit visible in the photo. e.g. 'royal blue tuxedo with black satin lapels, white dress shirt, black bow tie' or 'casual grey t-shirt'. Use null if not clearly visible.",
  "faceCount": number of distinct human faces clearly visible (0 if no face detected),
  "faceBox": {"x": left%, "y": top%, "w": width%, "h": height%} tight bounding box around the face only (forehead to chin, ear to ear) as percentages of image dimensions (0-100). Do NOT include shoulders or body — just the face. Use null if no face detected.
}

Return ONLY valid JSON, no markdown, no explanation.`;

interface VisionResponse {
  appearance: string;
  attire: string | null;
  faceCount: number;
  faceBox: { x: number; y: number; w: number; h: number } | null;
}

function parseVisionResponse(raw: string): VisionResponse {
  const defaults: VisionResponse = { appearance: raw, attire: null, faceCount: 0, faceBox: null };
  try {
    // Strip markdown code fences (case-insensitive, handles trailing whitespace)
    let cleaned = raw.replace(/^```\w*\s*\n?/im, '').replace(/\n?\s*```\s*$/m, '').trim();
    // If prose precedes the JSON, extract the first {...} block
    if (cleaned[0] !== '{') {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
      }
    }
    const parsed = JSON.parse(cleaned);
    return {
      appearance: parsed.appearance || raw,
      attire: typeof parsed.attire === 'string' ? parsed.attire : null,
      faceCount: typeof parsed.faceCount === 'number' ? parsed.faceCount : 0,
      faceBox: parsed.faceBox && typeof parsed.faceBox.x === 'number' ? parsed.faceBox : null,
    };
  } catch {
    // Fallback: use the raw text as appearance description (faceCount 0 = unknown)
    return defaults;
  }
}

/** Load an image from Uint8Array, call the worker, return the result */
function withLoadedImage<T>(
  photoData: Uint8Array,
  mimeType: string,
  worker: (img: HTMLImageElement) => T | Promise<T>,
): Promise<T> {
  const buf = photoData.buffer.slice(photoData.byteOffset, photoData.byteOffset + photoData.byteLength) as ArrayBuffer;
  const blob = new Blob([buf], { type: mimeType });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); Promise.resolve(worker(img)).then(resolve, reject); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

/** Compute a crop rect centered on the face, with face occupying `faceRatio` of the output */
function computeFaceCrop(
  imgW: number, imgH: number,
  faceBox: { x: number; y: number; w: number; h: number },
  faceRatio: number,
  aspectRatio?: number, // w/h, e.g. 0.75 for 3:4 portrait. undefined = square
): { cx: number; cy: number; cw: number; ch: number } | null {
  const faceX = Math.round(imgW * faceBox.x / 100);
  const faceY = Math.round(imgH * faceBox.y / 100);
  const faceW = Math.round(imgW * faceBox.w / 100);
  const faceH = Math.round(imgH * faceBox.h / 100);
  if (faceW < 10 || faceH < 10) return null;

  const faceCenterX = faceX + faceW / 2;
  const faceCenterY = faceY + faceH / 2;
  const faceDim = Math.max(faceW, faceH);
  const targetSize = Math.round(faceDim / faceRatio);

  let cw: number, ch: number;
  if (aspectRatio) {
    // Portrait rectangle: width = targetSize * aspectRatio, height = targetSize
    ch = Math.min(targetSize, imgH);
    cw = Math.min(Math.round(ch * aspectRatio), imgW);
    ch = Math.min(Math.round(cw / aspectRatio), imgH); // re-clamp
    cw = Math.max(cw, faceW);
    ch = Math.max(ch, faceH);
  } else {
    // Square: size the crop so the face fills `faceRatio` of the output circle.
    // Allow slight off-centering (face may shift from dead-center after clamping)
    // rather than shrinking the crop, which would make the face appear too small.
    let size = Math.min(targetSize, imgW, imgH);
    size = Math.max(size, faceDim);
    cw = ch = size;
  }

  let cx = Math.round(faceCenterX - cw / 2);
  let cy = Math.round(faceCenterY - ch / 2);

  // Clamp to image bounds
  if (cx < 0) cx = 0;
  if (cy < 0) cy = 0;
  if (cx + cw > imgW) cx = imgW - cw;
  if (cy + ch > imgH) cy = imgH - ch;
  if (cx < 0) { cx = 0; cw = imgW; }
  if (cy < 0) { cy = 0; ch = imgH; }

  return { cx, cy, cw: Math.min(cw, imgW - cx), ch: Math.min(ch, imgH - cy) };
}

/** Crop to face for avatar display — square, face ≈65%, 512px output (retina-ready) */
async function cropToFace(
  photoData: Uint8Array,
  mimeType: string,
  faceBox: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  return withLoadedImage(photoData, mimeType, (img) => {
    const crop = computeFaceCrop(img.width, img.height, faceBox, 0.65);
    if (!crop) throw new Error('Face box too small');

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.cx, crop.cy, crop.cw, crop.ch, 0, 0, 512, 512);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('Crop failed')),
        'image/jpeg', 0.92,
      );
    });
  });
}

/** Crop a reference photo for image generation — 3:4 portrait, face ≈26%, shortest side = 1024 */
async function cropReferencePhoto(
  photoData: Uint8Array,
  mimeType: string,
  faceBox: { x: number; y: number; w: number; h: number },
): Promise<Uint8Array> {
  return withLoadedImage(photoData, mimeType, (img) => {
    // Face occupies ~32% of crop height for tighter head-to-waist framing
    const crop = computeFaceCrop(img.width, img.height, faceBox, 0.32, 0.75);
    if (!crop) throw new Error('Face box too small');

    const TARGET_DIM = 1024;
    let { cx, cy, cw, ch } = crop;

    // Scale so shortest output side = 1024
    const shortSide = Math.min(cw, ch);
    const scale = TARGET_DIM / shortSide;
    let outW = Math.round(cw * scale);
    let outH = Math.round(ch * scale);

    // Face coordinates in source image pixels (for face-aware centering)
    const facePixelX = Math.round(img.width * faceBox.x / 100);
    const facePixelY = Math.round(img.height * faceBox.y / 100);
    const facePixelW = Math.round(img.width * faceBox.w / 100);
    const facePixelH = Math.round(img.height * faceBox.h / 100);

    // If the longer side exceeds 1024, shrink the source crop on that axis (face-aware centering)
    if (outW > TARGET_DIM) {
      const newCW = Math.round(TARGET_DIM / scale);
      const faceCenterX = facePixelX + facePixelW / 2;
      let newCX = Math.round(faceCenterX - newCW / 2);
      // Ensure face stays fully within the crop
      newCX = Math.min(newCX, facePixelX);
      if (newCX + newCW < facePixelX + facePixelW) newCX = facePixelX + facePixelW - newCW;
      // Clamp within original crop bounds
      newCX = Math.max(cx, Math.min(newCX, cx + cw - newCW));
      cx = newCX;
      cw = newCW;
      outW = TARGET_DIM;
    }
    if (outH > TARGET_DIM) {
      const newCH = Math.round(TARGET_DIM / scale);
      const faceCenterY = facePixelY + facePixelH / 2;
      let newCY = Math.round(faceCenterY - newCH / 2);
      // Ensure face stays fully within the crop
      newCY = Math.min(newCY, facePixelY);
      if (newCY + newCH < facePixelY + facePixelH) newCY = facePixelY + facePixelH - newCH;
      // Clamp within original crop bounds
      newCY = Math.max(cy, Math.min(newCY, cy + ch - newCH));
      cy = newCY;
      ch = newCH;
      outH = TARGET_DIM;
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, outW, outH);

    // Source -> crop -> output scaling complete

    return new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (!result) { reject(new Error('Reference crop failed')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
          reader.onerror = () => reject(new Error('Failed to read reference crop'));
          reader.readAsArrayBuffer(result);
        },
        'image/jpeg', 0.92,
      );
    });
  });
}

interface PersonaEditorPanelProps {
  persona: Persona | null;  // null = create mode
  hasSelfPersona?: boolean;
  onSave: (persona: Persona, faceCropBlob?: Blob | null) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onClose: () => void;
  getThumbnailUrl: (personaId: string) => Promise<string | null>;
  sogniClient?: SogniClient | null;
  tokenType?: TokenType;
}

export function PersonaEditorPanel({
  persona,
  hasSelfPersona = false,
  onSave,
  onDelete,
  onClose,
  getThumbnailUrl,
  sogniClient,
  tokenType,
}: PersonaEditorPanelProps) {
  const isEditMode = !!persona;
  const [name, setName] = useState(persona?.name || '');
  const [relationship, setRelationship] = useState(persona?.relationship || (hasSelfPersona ? 'friend' : 'self'));
  const [description, setDescription] = useState(persona?.description || '');
  const [tags, setTags] = useState<string[]>(persona?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [photoData, setPhotoData] = useState<Uint8Array | null>(persona?.photoData || null);
  const [photoMimeType, setPhotoMimeType] = useState<string | null>(persona?.photoMimeType || null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoWidth, setPhotoWidth] = useState<number | null>(persona?.photoWidth || null);
  const [photoHeight, setPhotoHeight] = useState<number | null>(persona?.photoHeight || null);
  const [visionDescription, setVisionDescription] = useState<string | null>(persona?.visionDescription || null);
  const [defaultAttire, setDefaultAttire] = useState<string | null>(persona?.defaultAttire ?? null);
  const [voice, setVoice] = useState<string | null>(persona?.voice ?? null);
  const [voiceClipData, setVoiceClipData] = useState<Uint8Array | null>(persona?.voiceClipData || null);
  const [voiceClipMimeType, setVoiceClipMimeType] = useState<string | null>(persona?.voiceClipMimeType || null);
  const [voiceClipDuration, setVoiceClipDuration] = useState<number | null>(persona?.voiceClipDuration || null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [multiFaceWarning, setMultiFaceWarning] = useState(false);
  const [faceCropData, setFaceCropData] = useState<Blob | null>(null);
  const [referencePhotoData, setReferencePhotoData] = useState<Uint8Array | null>(persona?.referencePhotoData || null);
  const [isNewPhoto, setIsNewPhoto] = useState(false); // Track whether user uploaded a new photo this session
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewRef = useRef<string | null>(null);
  // Track which photoData the current visionDescription belongs to, to prevent re-analysis
  const analyzedPhotoRef = useRef<Uint8Array | null>(persona?.photoData || null);

  // Keep ref in sync with photoPreview state
  useEffect(() => { photoPreviewRef.current = photoPreview; }, [photoPreview]);

  // Revoke blob URL on unmount
  useEffect(() => { return () => { if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current); }; }, []);

  // Close on Escape key (blur input first if focused)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          (e.target as HTMLElement).blur();
          return;
        }
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Generate preview URL for existing photo on mount
  useEffect(() => {
    if (!photoData) return;
    const buf = photoData.buffer.slice(photoData.byteOffset, photoData.byteOffset + photoData.byteLength) as ArrayBuffer;
    const blob = new Blob([buf], { type: photoMimeType || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
    // Only run on mount for initial photo data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create a preview URL from the face crop blob
  const faceCropPreviewUrl = useMemo(() => {
    if (!faceCropData) return null;
    return URL.createObjectURL(faceCropData);
  }, [faceCropData]);

  // Revoke face crop preview URL when it changes or on unmount
  useEffect(() => {
    return () => { if (faceCropPreviewUrl) URL.revokeObjectURL(faceCropPreviewUrl); };
  }, [faceCropPreviewUrl]);

  // Auto-analyze photo when it changes (new upload)
  useEffect(() => {
    if (!photoData || !sogniClient || !tokenType) return;
    // Don't re-analyze if we already have a description for this exact photo
    if (visionDescription && analyzedPhotoRef.current === photoData) return;

    let cancelled = false;
    setAnalyzing(true);

    (async () => {
      try {
        const dataUri = await resizeUint8ArrayForVision(photoData, photoMimeType || 'image/jpeg');
        const { fullContent } = await sendVisionAnalysis(
          sogniClient,
          dataUri,
          tokenType,
          {
            onToken: () => {},
            onComplete: () => {},
            onError: (err) => console.error('[PERSONA EDITOR] Vision analysis error:', err),
          },
          {
            systemPrompt: PERSONA_VISION_PROMPT,
            userText: 'Analyze this photo for persona creation. Return JSON only.',
          },
        );
        if (cancelled || !fullContent) return;

        // Parse the structured response
        const parsed = parseVisionResponse(fullContent);
        if (parsed.faceCount > 1) {
          setMultiFaceWarning(true);
        } else {
          setMultiFaceWarning(false);
        }
        setVisionDescription(parsed.appearance);
        setDefaultAttire(parsed.attire);
        analyzedPhotoRef.current = photoData;

        // Auto-crop to face if bounding box detected
        if (parsed.faceBox) {
          const mime = photoMimeType || 'image/jpeg';
          try {
            const [cropped, refPhoto] = await Promise.all([
              cropToFace(photoData, mime, parsed.faceBox),
              cropReferencePhoto(photoData, mime, parsed.faceBox),
            ]);
            if (!cancelled) {
              setFaceCropData(cropped);
              setReferencePhotoData(refPhoto);
            }
          } catch (err) {
            console.warn('[PERSONA EDITOR] Face crop failed, using full photo:', err);
          }
        }
      } catch (err) {
        console.error('[PERSONA EDITOR] Auto-analyze failed:', err);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoData, sogniClient, tokenType]);

  const handlePhotoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    // Read and resize to max 1024px
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1024;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          const arr = new Uint8Array(reader.result as ArrayBuffer);
          setPhotoData(arr);
          setPhotoMimeType('image/jpeg');
          setPhotoWidth(w);
          setPhotoHeight(h);
          setVisionDescription(null); // Reset vision description for new photo
          setMultiFaceWarning(false);
          setFaceCropData(null);
          setReferencePhotoData(null);
          setIsNewPhoto(true);
          // Create preview
          const previewUrl = URL.createObjectURL(blob);
          setPhotoPreview(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return previewUrl;
          });
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/jpeg', 0.92);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
    };

    img.src = url;
    // Reset input so same file can be selected again
    e.target.value = '';
  }, []);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  }, []);

  const handleReanalyze = useCallback(async () => {
    if (!photoData || !sogniClient || !tokenType) return;
    setAnalyzing(true);
    setMultiFaceWarning(false);
    setFaceCropData(null);
    try {
      const dataUri = await resizeUint8ArrayForVision(photoData, photoMimeType || 'image/jpeg');
      const { fullContent } = await sendVisionAnalysis(
        sogniClient,
        dataUri,
        tokenType,
        {
          onToken: () => {},
          onComplete: () => {},
          onError: (err) => console.error('[PERSONA EDITOR] Vision analysis error:', err),
        },
        {
          systemPrompt: PERSONA_VISION_PROMPT,
          userText: 'Analyze this photo for persona creation. Return JSON only.',
        },
      );
      if (fullContent) {
        const parsed = parseVisionResponse(fullContent);
        if (parsed.faceCount > 1) {
          setMultiFaceWarning(true);
        } else {
          setMultiFaceWarning(false);
        }
        setVisionDescription(parsed.appearance);
        setDefaultAttire(parsed.attire);
        analyzedPhotoRef.current = photoData;

        if (parsed.faceBox) {
          const mime = photoMimeType || 'image/jpeg';
          try {
            const [cropped, refPhoto] = await Promise.all([
              cropToFace(photoData, mime, parsed.faceBox),
              cropReferencePhoto(photoData, mime, parsed.faceBox),
            ]);
            setFaceCropData(cropped);
            setReferencePhotoData(refPhoto);
          } catch (err) {
            console.warn('[PERSONA EDITOR] Face crop failed, using full photo:', err);
          }
        }
      }
    } catch (err) {
      console.error('[PERSONA EDITOR] Re-analyze failed:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [photoData, photoMimeType, sogniClient, tokenType]);

  const handleVoiceClipChange = useCallback((data: Uint8Array | null, mimeType: string | null, duration: number | null) => {
    setVoiceClipData(data);
    setVoiceClipMimeType(mimeType);
    setVoiceClipDuration(duration);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const now = Date.now();
      const updated: Persona = {
        id: persona?.id || crypto.randomUUID(),
        name: name.trim(),
        relationship,
        description: description.trim(),
        tags,
        photoData,
        photoMimeType,
        photoWidth,
        photoHeight,
        visionDescription,
        referencePhotoData,
        defaultAttire: defaultAttire || null,
        voice: voice || null,
        voiceClipData: voiceClipData || null,
        voiceClipMimeType: voiceClipMimeType || null,
        voiceClipDuration: voiceClipDuration || null,
        createdAt: persona?.createdAt || now,
        updatedAt: now,
      };
      await onSave(updated, faceCropData);
      onClose();
    } catch (err) {
      console.error('[PERSONA EDITOR] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [name, relationship, description, tags, photoData, photoMimeType, photoWidth, photoHeight, visionDescription, referencePhotoData, defaultAttire, voice, voiceClipData, voiceClipMimeType, voiceClipDuration, persona, onSave, onClose, faceCropData]);

  const handleDelete = useCallback(async () => {
    if (!persona?.id || !onDelete) return;
    try {
      await onDelete(persona.id);
      onClose();
    } catch (err) {
      console.error('[PERSONA EDITOR] Delete failed:', err);
    }
  }, [persona, onDelete, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(4px)',
          zIndex: 200,
          animation: 'backdropFadeIn 0.15s ease',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '340px',
          maxWidth: '100vw',
          height: '100%',
          background: '#171717',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInFromLeft 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#ececec' }}>
              {isEditMode ? 'Edit Person' : 'Add Person'}
            </span>
            <div style={{ fontSize: '0.6875rem', color: '#666', marginTop: '2px' }}>
              Add people so the AI can include them in creations
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: '#8e8e8e',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ececec'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; e.currentTarget.style.background = 'none'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable form */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Photo upload */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '20px' }}>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{ cursor: 'pointer', marginBottom: '8px' }}
            >
              {faceCropPreviewUrl ? (
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden',
                  border: '2px solid rgba(255,255,255,0.15)',
                }}>
                  <img src={faceCropPreviewUrl} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.08)' }} />
                </div>
              ) : isNewPhoto && photoPreview ? (
                <div style={{
                  width: '80px', height: '80px', borderRadius: '50%', overflow: 'hidden',
                  border: '2px solid rgba(255,255,255,0.15)',
                }}>
                  <img src={photoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.08)' }} />
                </div>
              ) : (
                <PersonaAvatar
                  personaId={persona?.id || 'new'}
                  name={name || '?'}
                  size="lg"
                  getThumbnailUrl={getThumbnailUrl}
                  updatedAt={persona?.updatedAt}
                />
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                fontSize: '0.75rem', color: '#b4b4b4', background: 'none', border: 'none', cursor: 'pointer',
                textDecoration: 'underline', padding: '2px 4px',
              }}
            >
              {photoData ? 'Change photo' : 'Add photo'}
            </button>
            {/* Auto-analyzing indicator */}
            {analyzing && (
              <span style={{
                marginTop: '6px',
                fontSize: '0.6875rem',
                color: '#8e8e8e',
                animation: 'pulse-premium 1.5s ease-in-out infinite',
              }}>
                Analyzing photo...
              </span>
            )}
            {/* Multi-face warning */}
            {multiFaceWarning && !analyzing && (
              <span style={{
                marginTop: '6px',
                fontSize: '0.6875rem',
                color: '#f59e0b',
                textAlign: 'center',
                lineHeight: 1.4,
                maxWidth: '260px',
              }}>
                Multiple faces detected — for best results, use a photo with just one person.
              </span>
            )}
            {/* Re-analyze button (only shown when description already exists) */}
            {visionDescription && !analyzing && photoData && sogniClient && tokenType && (
              <button
                onClick={handleReanalyze}
                style={{
                  marginTop: '6px',
                  padding: '5px 12px',
                  borderRadius: '100px',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#b4b4b4',
                  transition: 'all 0.15s',
                }}
              >
                Re-analyze
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handlePhotoSelect}
            />
          </div>

          {/* Name */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Name *
              </label>
              <HelpTip text={getHints(relationship).nameHelp} />
            </div>
            <input
              className="persona-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={getHints(relationship).namePlaceholder}
              style={{
                width: '100%', padding: '8px 12px', background: '#212121', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-md)', color: '#ececec', fontSize: '0.8125rem', outline: 'none',
              }}
            />
          </div>

          {/* Relationship */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Relationship
              </label>
              <HelpTip text={'Helps the AI understand context when you say things like "me and my wife" or "a photo with my dog"'} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {RELATIONSHIPS.map(r => (
                <button
                  key={r}
                  onClick={() => setRelationship(r)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '100px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    background: relationship === r ? '#ffffff' : 'rgba(255,255,255,0.06)',
                    color: relationship === r ? '#0a0a0a' : '#b4b4b4',
                    transition: 'all 0.15s',
                    textTransform: 'capitalize',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Description
              </label>
              <HelpTip text={getHints(relationship).descHelp} />
            </div>
            <textarea
              className="persona-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={getHints(relationship).descPlaceholder}
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', background: '#212121', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-md)', color: '#ececec', fontSize: '0.8125rem', outline: 'none',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            {!photoData && (
              <div style={{ fontSize: '0.625rem', color: '#555', marginTop: '4px' }}>
                Tip: {getHints(relationship).photoTip}
              </div>
            )}
          </div>

          {/* Nicknames */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Nicknames
              </label>
              <HelpTip text={getHints(relationship).nickHelp} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
              {tags.map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px',
                  background: 'rgba(255,255,255,0.06)', borderRadius: '100px', fontSize: '0.6875rem', color: '#b4b4b4',
                }}>
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 0, lineHeight: 1 }}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <input
              className="persona-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
              placeholder={getHints(relationship).nickPlaceholder}
              style={{
                width: '100%', padding: '6px 10px', background: '#212121', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 'var(--radius-md)', color: '#ececec', fontSize: '0.75rem', outline: 'none',
              }}
            />
          </div>

          {/* Vision description (editable) */}
          {visionDescription != null && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  AI Description
                </label>
                <HelpTip text="Auto-generated from your photo. Edit to tweak — the AI uses this text to recreate their appearance in new images and videos." />
              </div>
              <textarea
                value={visionDescription}
                onChange={(e) => setVisionDescription(e.target.value)}
                rows={3}
                style={{
                  width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem', color: '#b4b4b4', lineHeight: 1.5, outline: 'none',
                  resize: 'vertical', fontFamily: 'inherit',
                }}
              />
            </div>
          )}

          {/* Default Attire (optional, auto-populated from photo) */}
          {(defaultAttire != null || visionDescription != null) && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Default Attire
                </label>
                <HelpTip text="Detected from the photo. When set, the AI will use this outfit unless the prompt specifies otherwise. Clear it to let the generation scenario fully control clothing." />
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  className="persona-input"
                  value={defaultAttire || ''}
                  onChange={(e) => setDefaultAttire(e.target.value || null)}
                  placeholder="e.g. casual grey t-shirt, blue jeans"
                  style={{
                    width: '100%', padding: '8px 12px', paddingRight: defaultAttire ? '32px' : '12px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)',
                    fontSize: '0.75rem', color: '#b4b4b4', outline: 'none',
                  }}
                />
                {defaultAttire && (
                  <button
                    onClick={() => setDefaultAttire(null)}
                    title="Clear — let the scenario control attire"
                    style={{
                      position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: '#666',
                      padding: '2px', lineHeight: 1, fontSize: '0.75rem',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#b4b4b4'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#666'; }}
                  >
                    &times;
                  </button>
                )}
              </div>
              {!defaultAttire && visionDescription && (
                <div style={{ fontSize: '0.625rem', color: '#555', marginTop: '4px' }}>
                  Cleared — clothing will be determined by the generation prompt.
                </div>
              )}
            </div>
          )}

          {/* Voice (optional) */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#8e8e8e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Voice
              </label>
              <HelpTip text="Used when generating videos with dialogue or animation. Describe their accent, tone, and vocal qualities so the AI can match their voice." />
            </div>
            <input
              className="persona-input"
              value={voice || ''}
              onChange={(e) => setVoice(e.target.value || null)}
              placeholder={relationship === 'pet' ? 'e.g. playful bark, soft purr' : 'e.g. warm baritone, slight Southern accent'}
              style={{
                width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)',
                fontSize: '0.75rem', color: '#b4b4b4', outline: 'none',
              }}
            />

            {/* Voice clip recorder/uploader */}
            <VoiceClipManager
              voiceClipData={voiceClipData}
              voiceClipMimeType={voiceClipMimeType}
              voiceClipDuration={voiceClipDuration}
              onVoiceClipChange={handleVoiceClipChange}
            />
          </div>

          {/* Privacy notice */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0',
            fontSize: '0.6875rem', color: '#666',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Photos are stored on your device. Analysis uses the Sogni AI service.
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isEditMode ? 'space-between' : 'flex-end',
          flexShrink: 0,
        }}>
          {isEditMode && onDelete && (
            confirmDelete ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Delete?</span>
                <button
                  onClick={handleDelete}
                  style={{ fontSize: '0.75rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{ fontSize: '0.75rem', color: '#8e8e8e', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ fontSize: '0.8125rem', color: '#8e8e8e', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#8e8e8e'; }}
              >
                Delete
              </button>
            )
          )}
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{
              padding: '8px 24px',
              background: name.trim() ? '#ffffff' : '#555',
              color: name.trim() ? '#0a0a0a' : '#999',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: name.trim() && !saving ? 'pointer' : 'not-allowed',
              opacity: saving ? 0.6 : 1,
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}
