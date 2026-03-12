#!/usr/bin/env node

/**
 * CDN Asset Sync Script for sogni-chat
 *
 * Uploads assets from local-scripts/assets/ to Cloudflare R2
 * and regenerates src/assets/cdn.ts manifest.
 *
 * Prerequisites:
 * - rclone installed with 'sogni-r2' remote configured
 *
 * Usage:
 *   node local-scripts/sync-assets.js            # Upload new/changed assets
 *   node local-scripts/sync-assets.js --force     # Re-upload all assets
 *   node local-scripts/sync-assets.js --dry-run   # Preview without uploading
 *   node local-scripts/sync-assets.js --manifest   # Regenerate manifest only (no upload)
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  appendFileSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const R2_REMOTE = 'sogni-r2:safetensor-sogni-ai/sogni-chat';
const CDN_BASE = 'https://cdn.sogni.ai/sogni-chat';
const ASSETS_DIR = join(__dirname, 'assets');
const MANIFEST_PATH = join(__dirname, '..', 'src', 'assets', 'cdn.ts');
const COMPLETED_CSV = join(__dirname, 'completed.csv');
const METADATA_CACHE = join(__dirname, 'video-metadata.json');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const MANIFEST_ONLY = args.includes('--manifest');

// ── Asset folder config ──────────────────────────────────────────
// Each top-level folder in assets/ maps to a category in the manifest.
// Add new folders here as needed.

const FOLDER_CONFIG = {
  // Object folders: files become camelCase keys -> URL values
  videos: { type: 'object' },
  images: { type: 'object' },
  audio: { type: 'object' },
};

// ── Prerequisite checks ───────────────────────────────────────────

function checkPrerequisites() {
  try {
    execSync('rclone version', { stdio: 'pipe' });
  } catch {
    console.error(
      'Error: rclone is not installed. Install it from https://rclone.org/install/'
    );
    process.exit(1);
  }

  try {
    const remotes = execSync('rclone listremotes', { encoding: 'utf-8' });
    if (!remotes.includes('sogni-r2:')) {
      console.error(
        'Error: sogni-r2 remote not configured. Run: rclone config'
      );
      process.exit(1);
    }
  } catch (e) {
    console.error('Error checking rclone remotes:', e.message);
    process.exit(1);
  }
}

// ── File discovery ────────────────────────────────────────────────

function fileHash(filePath) {
  const content = readFileSync(filePath);
  return createHash('md5').update(content).digest('hex').slice(0, 8);
}

function getLocalFiles(dir, base = dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getLocalFiles(fullPath, base));
    } else if (!entry.name.startsWith('.')) {
      files.push({
        localPath: fullPath,
        remotePath: relative(base, fullPath),
        size: statSync(fullPath).size,
        hash: fileHash(fullPath),
      });
    }
  }
  return files;
}

function getRemoteFiles() {
  try {
    const output = execSync(
      `rclone lsjson "${R2_REMOTE}/" --recursive --no-modtime --no-mimetype`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const entries = JSON.parse(output);
    const map = new Map();
    for (const entry of entries) {
      if (!entry.IsDir) {
        map.set(entry.Path, entry.Size);
      }
    }
    return map;
  } catch (e) {
    console.warn('Warning: Could not list remote files, assuming empty:', e.message);
    return new Map();
  }
}

// ── Upload ────────────────────────────────────────────────────────

function uploadFile(file) {
  const remoteDir = dirname(file.remotePath);
  const dest =
    remoteDir === '.' ? R2_REMOTE : `${R2_REMOTE}/${remoteDir}`;
  try {
    execSync(`rclone copy "${file.localPath}" "${dest}/"`, {
      stdio: 'pipe',
      timeout: 120000,
    });
    return true;
  } catch (e) {
    console.error(`  Failed to upload ${file.remotePath}: ${e.message}`);
    return false;
  }
}

// ── Metadata scraping ─────────────────────────────────────────────

function loadMetadataCache() {
  if (existsSync(METADATA_CACHE)) {
    return JSON.parse(readFileSync(METADATA_CACHE, 'utf-8'));
  }
  return {};
}

function saveMetadataCache(cache) {
  writeFileSync(METADATA_CACHE, JSON.stringify(cache, null, 2));
}

function hasFfprobe() {
  try {
    execSync('ffprobe -version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function probeVideo(filePath) {
  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    return JSON.parse(output);
  } catch {
    return null;
  }
}

function parseFPS(rateStr) {
  if (!rateStr || rateStr === '0/0') return null;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = parseInt(parts[0]);
    const den = parseInt(parts[1]);
    return den > 0 ? num / den : null;
  }
  return parseFloat(rateStr) || null;
}

function extractPositivePrompt(promptObj) {
  if (!promptObj || typeof promptObj !== 'object') return null;
  for (const node of Object.values(promptObj)) {
    if (!node || typeof node !== 'object') continue;
    const classType = node.class_type;
    const inputs = node.inputs;
    const title = node._meta?.title?.toLowerCase() || '';
    if (!classType || !inputs) continue;
    if (['CLIPTextEncode', 'CLIPTextEncodeFlux', 'TextEncodeQwenImageEditPlus'].includes(classType)) {
      if (title.includes('negative')) continue;
      const text = (inputs.text || inputs.prompt || '').trim();
      if (text) return text;
    }
  }
  return null;
}

function extractPromptFromTags(tags) {
  if (!tags) return null;
  for (const [key, value] of Object.entries(tags)) {
    if (typeof value !== 'string') continue;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (key.toLowerCase() === 'prompt') return extractPositivePrompt(parsed);
      if (parsed.prompt) {
        const p = typeof parsed.prompt === 'string' ? JSON.parse(parsed.prompt) : parsed.prompt;
        return extractPositivePrompt(p);
      }
    } catch { /* not JSON */ }
  }
  for (const key of ['description', 'comment', 'title']) {
    if (tags[key] && typeof tags[key] === 'string' && !tags[key].startsWith('{')) {
      return tags[key];
    }
  }
  return null;
}

function extractVideoMetadata(filePath) {
  const probe = probeVideo(filePath);
  if (!probe) return null;

  const metadata = { model: 'LTX-2.3 23b Image-to-Video' };

  if (probe.format?.duration) {
    metadata.duration = parseFloat(parseFloat(probe.format.duration).toFixed(2));
  }

  const videoStream = probe.streams?.find(s => s.codec_type === 'video');
  if (videoStream) {
    metadata.resolution = `${videoStream.width}x${videoStream.height}`;
    const fps = parseFPS(videoStream.r_frame_rate);
    if (fps) metadata.fps = Math.round(fps);
  }

  const prompt = extractPromptFromTags(probe.format?.tags);
  if (prompt) metadata.prompt = prompt;

  if (!metadata.prompt && videoStream?.tags) {
    const streamPrompt = extractPromptFromTags(videoStream.tags);
    if (streamPrompt) metadata.prompt = streamPrompt;
  }

  return metadata;
}

function scrapeMetadata(files) {
  if (!hasFfprobe()) {
    console.warn('Warning: ffprobe not found — skipping metadata scraping.');
    console.warn('Install ffmpeg to enable metadata extraction.\n');
    return loadMetadataCache();
  }

  const cache = loadMetadataCache();
  const videoFiles = files.filter(f => f.remotePath.startsWith('videos/'));

  let scraped = 0;
  let cached = 0;

  for (const file of videoFiles) {
    const key = toCamelCase(basename(file.remotePath, extname(file.remotePath)));

    if (cache[key] && cache[key].hash === file.hash) {
      cached++;
      continue;
    }

    process.stdout.write(`  Scraping metadata: ${file.remotePath}...`);
    const meta = extractVideoMetadata(file.localPath);
    if (meta) {
      cache[key] = { ...meta, hash: file.hash };
      scraped++;
      console.log(' done');
    } else {
      console.log(' failed');
    }
  }

  if (scraped > 0) {
    saveMetadataCache(cache);
  }

  console.log(`Metadata: ${scraped} scraped, ${cached} cached\n`);
  return cache;
}

// ── Manifest generation ───────────────────────────────────────────

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function toCamelCase(str) {
  return str.replace(/[-_]+(.)/g, (_, c) => c.toUpperCase());
}

function generateManifest(files, metadataCache = {}) {
  // Group files by top-level folder
  const byFolder = {};
  const hashMap = {};
  for (const f of files) {
    const parts = f.remotePath.split('/');
    const folder = parts[0];
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(f.remotePath);
    hashMap[f.remotePath] = f.hash;
  }

  // Warn about unknown folders
  for (const folder of Object.keys(byFolder)) {
    if (!FOLDER_CONFIG[folder]) {
      console.warn(`Warning: Unknown folder "${folder}" in assets — not included in manifest. Add it to FOLDER_CONFIG in sync-assets.js.`);
    }
  }

  function url(p) {
    return `\`\${CDN_BASE}/${p}?v=${hashMap[p]}\``;
  }

  const lines = [`const CDN_BASE = '${CDN_BASE}';`, ''];

  // VideoMetadata interface
  lines.push('export interface VideoMetadata {');
  lines.push('  resolution: string;');
  lines.push('  fps: number;');
  lines.push('  duration: number;');
  lines.push('  prompt?: string;');
  lines.push('  model: string;');
  lines.push('}');
  lines.push('');

  lines.push('export const cdnAssets = {');

  // Process each configured folder in declaration order
  for (const [folder, config] of Object.entries(FOLDER_CONFIG)) {
    if (!byFolder[folder]) continue;

    const paths = byFolder[folder].sort(naturalSort);

    if (config.type === 'object') {
      // Flat object: camelCase keys from filenames
      // If files are in subfolders, nest one level deep
      const hasSubfolders = paths.some((p) => p.split('/').length > 2);

      if (hasSubfolders) {
        // Group by subfolder
        lines.push(`  ${folder}: {`);
        const subfolders = {};
        for (const p of paths) {
          const parts = p.split('/');
          if (parts.length > 2) {
            const sub = parts[1];
            if (!subfolders[sub]) subfolders[sub] = [];
            subfolders[sub].push(p);
          } else {
            // Top-level file in the folder
            const name = toCamelCase(basename(p, extname(p)));
            lines.push(`    ${name}: ${url(p)},`);
          }
        }
        for (const [sub, subPaths] of Object.entries(subfolders).sort()) {
          const camelSub = toCamelCase(sub);
          lines.push(`    ${camelSub}: {`);
          for (const p of subPaths.sort(naturalSort)) {
            const name = toCamelCase(basename(p, extname(p)));
            lines.push(`      ${name}: ${url(p)},`);
          }
          lines.push('    },');
        }
        lines.push('  },');
      } else {
        // Simple flat object
        lines.push(`  ${folder}: {`);
        for (const p of paths) {
          const name = toCamelCase(basename(p, extname(p)));
          lines.push(`    ${name}: ${url(p)},`);
        }
        lines.push('  },');
      }
    }
  }

  lines.push('} as const;');
  lines.push('');

  // Video metadata export
  const metaKeys = Object.keys(metadataCache).sort(naturalSort);
  lines.push('export const videoMetadata: Record<string, VideoMetadata> = {');
  for (const key of metaKeys) {
    const { hash, ...meta } = metadataCache[key];
    const parts = [];
    if (meta.resolution) parts.push(`resolution: '${meta.resolution}'`);
    if (meta.fps != null) parts.push(`fps: ${meta.fps}`);
    if (meta.duration != null) parts.push(`duration: ${meta.duration}`);
    if (meta.prompt) parts.push(`prompt: ${JSON.stringify(meta.prompt)}`);
    parts.push(`model: '${meta.model || 'LTX-2.3 23b Image-to-Video'}'`);
    lines.push(`  ${key}: { ${parts.join(', ')} },`);
  }
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

// ── Logging ───────────────────────────────────────────────────────

function logCompleted(file) {
  const line = `${file.remotePath},${CDN_BASE}/${file.remotePath},${new Date().toISOString()}\n`;
  appendFileSync(COMPLETED_CSV, line);
}

// ── Prompt ────────────────────────────────────────────────────────

function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('CDN Asset Sync for sogni-chat');
  console.log('============================\n');

  if (!existsSync(ASSETS_DIR)) {
    console.log(`Assets directory not found: ${ASSETS_DIR}`);
    console.log('Creating directory structure...\n');
    for (const dir of Object.keys(FOLDER_CONFIG)) {
      mkdirSync(join(ASSETS_DIR, dir), { recursive: true });
    }
    console.log(
      'Place your assets in local-scripts/assets/ and run again.'
    );
    process.exit(0);
  }

  const localFiles = getLocalFiles(ASSETS_DIR);
  if (localFiles.length === 0) {
    console.log('No assets found in local-scripts/assets/');
    console.log('Place your assets there and run again.');
    process.exit(0);
  }

  const totalSize = localFiles.reduce((s, f) => s + f.size, 0);
  console.log(
    `Found ${localFiles.length} local assets (${(totalSize / 1024 / 1024).toFixed(1)} MB)\n`
  );

  if (!MANIFEST_ONLY) {
    checkPrerequisites();

    let filesToUpload = localFiles;

    if (!FORCE) {
      console.log('Checking remote files...');
      const remoteFiles = getRemoteFiles();
      filesToUpload = localFiles.filter((f) => {
        const remoteSize = remoteFiles.get(f.remotePath);
        if (remoteSize === undefined) return true; // new file
        if (remoteSize !== f.size) return true; // size changed
        return false;
      });
      const newCount = filesToUpload.filter(
        (f) => !remoteFiles.has(f.remotePath)
      ).length;
      const changedCount = filesToUpload.length - newCount;
      const skipped = localFiles.length - filesToUpload.length;
      console.log(
        `${newCount} new, ${changedCount} changed, ${skipped} unchanged (skipped)\n`
      );
    }

    if (filesToUpload.length > 0 && !DRY_RUN) {
      console.log('Files to upload:');
      for (const f of filesToUpload) {
        console.log(
          `  ${f.remotePath} (${(f.size / 1024).toFixed(0)} KB)`
        );
      }
      console.log();

      const answer = await prompt('Proceed with upload? (y/n) ');
      if (answer !== 'y') {
        console.log('Aborted.');
        process.exit(0);
      }

      // Init completed.csv if needed
      if (!existsSync(COMPLETED_CSV)) {
        writeFileSync(COMPLETED_CSV, 'remote_path,cdn_url,timestamp\n');
      }

      let uploaded = 0;
      let failed = 0;
      for (const file of filesToUpload) {
        process.stdout.write(`  Uploading ${file.remotePath}...`);
        if (uploadFile(file)) {
          logCompleted(file);
          uploaded++;
          console.log(' done');
        } else {
          failed++;
          console.log(' FAILED');
        }
      }
      console.log(
        `\nUpload complete: ${uploaded} succeeded, ${failed} failed\n`
      );
    } else if (DRY_RUN && filesToUpload.length > 0) {
      console.log('[DRY RUN] Would upload:');
      for (const f of filesToUpload) {
        console.log(
          `  ${f.remotePath} (${(f.size / 1024).toFixed(0)} KB)`
        );
      }
      console.log();
    } else if (filesToUpload.length === 0) {
      console.log('All files already on R2. Nothing to upload.\n');
    }
  }

  // Scrape metadata for video files (even for already-uploaded videos)
  console.log('Checking video metadata...');
  const metadataCache = scrapeMetadata(localFiles);

  // Regenerate manifest from ALL local files
  console.log('Regenerating src/assets/cdn.ts...');
  const manifest = generateManifest(localFiles, metadataCache);
  if (!DRY_RUN) {
    writeFileSync(MANIFEST_PATH, manifest);
    console.log('Manifest updated.\n');
  } else {
    console.log('[DRY RUN] Would write manifest:\n');
    console.log(manifest);
  }

  console.log('Done!');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
