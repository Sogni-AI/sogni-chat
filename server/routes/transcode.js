import express from 'express';
import multer from 'multer';
import sharp from 'sharp';

const router = express.Router();

// MIME types that need transcoding
const TRANSCODE_TYPES = new Set([
  'image/webp',
  'image/heif',
  'image/heic',
  'image/avif',
]);

// All accepted types (transcode targets + passthrough)
const ACCEPTED_TYPES = new Set([
  ...TRANSCODE_TYPES,
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

// Multer: memory storage, 10MB limit, image-only filter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase().split('.').pop();
    if (ACCEPTED_TYPES.has(file.mimetype) || ['heif', 'heic', 'webp', 'avif', 'jpg', 'jpeg', 'png'].includes(ext || '')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported image format'), false);
    }
  }
});

/**
 * POST /api/transcode
 * Accepts multipart file upload, transcodes WebP/HEIF/HEIC to JPEG.
 * Returns transcoded JPEG binary with dimensions in headers.
 */
router.post('/', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 10MB.' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { mimetype, buffer, originalname } = req.file;

    // Extension-based fallback for HEIF/HEIC (some browsers send empty or generic MIME)
    const ext = (originalname || '').toLowerCase().split('.').pop();
    const effectiveMime = (mimetype && mimetype !== 'application/octet-stream')
      ? mimetype.toLowerCase()
      : (ext === 'heif' ? 'image/heif' : ext === 'heic' ? 'image/heic' : ext === 'avif' ? 'image/avif' : mimetype);

    if (!ACCEPTED_TYPES.has(effectiveMime)) {
      return res.status(415).json({
        error: `Unsupported image format: ${effectiveMime}. Accepted: JPG, PNG, WebP, HEIF, AVIF.`
      });
    }

    // If already JPEG or PNG, no transcoding needed — return as-is with dimensions
    if (effectiveMime === 'image/jpeg' || effectiveMime === 'image/jpg' || effectiveMime === 'image/png') {
      const metadata = await sharp(buffer).metadata();
      res.set({
        'Content-Type': effectiveMime,
        'X-Image-Width': String(metadata.width),
        'X-Image-Height': String(metadata.height),
      });
      return res.send(buffer);
    }

    // Transcode to JPEG
    console.log(`[TRANSCODE] Converting ${effectiveMime} (${originalname}) to JPEG`);
    const result = await sharp(buffer)
      .jpeg({ quality: 95 })
      .toBuffer({ resolveWithObject: true });

    res.set({
      'Content-Type': 'image/jpeg',
      'X-Image-Width': String(result.info.width),
      'X-Image-Height': String(result.info.height),
    });
    res.send(result.data);

    console.log(`[TRANSCODE] Done: ${result.info.width}x${result.info.height}, ${(result.data.length / 1024).toFixed(0)}KB`);
  } catch (err) {
    console.error('[TRANSCODE] Error:', err);
    res.status(500).json({ error: 'Failed to transcode image' });
  }
});

export default router;
