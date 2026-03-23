/**
 * Download Routes
 * Proxies image downloads to add proper Content-Disposition headers
 */

import express from 'express';

const router = express.Router();

// Allowed domains for download proxy (prevents SSRF)
const ALLOWED_DOMAINS = [
  'sogni.ai',
  'storage.googleapis.com',
  'cdn.sogni.ai',
  'api.sogni.ai',
  'api-staging.sogni.ai',
  'api-local.sogni.ai'
];

function isAllowedUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Check domain against allowlist
    return ALLOWED_DOMAINS.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  // Strip path separators, control chars, quotes, and non-ASCII
  return String(filename)
    .replace(/[/\\:*?"<>|'\r\n\t]/g, '_')
    .replace(/[^\w\s.-]/g, '_')
    .slice(0, 255);
}

/**
 * GET /api/download
 * Proxies an image download with proper headers to trigger native OS download
 */
router.get('/', async (req, res) => {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    if (!filename) {
      return res.status(400).json({ error: 'Filename parameter is required' });
    }

    // Validate URL against allowlist (prevents SSRF)
    if (!isAllowedUrl(url)) {
      console.warn('[Download] Blocked URL not in allowlist:', url);
      return res.status(403).json({ error: 'URL not allowed' });
    }

    const safeFilename = sanitizeFilename(filename);

    console.log('[Download] Proxying download:', { url, filename: safeFilename });

    // Fetch from the source URL
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[Download] Failed to fetch:', response.status, response.statusText);
      return res.status(response.status).json({
        error: 'Failed to fetch file'
      });
    }

    // Get content type from the source response, or default to application/octet-stream
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    // Set headers to trigger download with native OS dialog
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Pipe the response body directly to the client (no buffering)
    const { Readable } = await import('stream');
    const readable = Readable.fromWeb(response.body);
    readable.pipe(res);
  } catch (error) {
    console.error('[Download] Download failed:', error);
    res.status(500).json({ error: 'Failed to download image' });
  }
});

export default router;
