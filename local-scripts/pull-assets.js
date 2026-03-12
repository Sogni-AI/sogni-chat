#!/usr/bin/env node

/**
 * CDN Asset Pull Script for sogni-chat
 *
 * Downloads all assets from Cloudflare R2 to local-scripts/assets/.
 * Useful for new developers setting up the repo, or to refresh local
 * copies with the latest versions from R2.
 *
 * Prerequisites:
 * - rclone installed with 'sogni-r2' remote configured
 *
 * Usage:
 *   node local-scripts/pull-assets.js           # Download missing assets only
 *   node local-scripts/pull-assets.js --force    # Re-download all assets (overwrite local)
 *   node local-scripts/pull-assets.js --dry-run  # Preview without downloading
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const R2_REMOTE = 'sogni-r2:safetensor-sogni-ai/sogni-chat';
const ASSETS_DIR = join(__dirname, 'assets');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

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
  console.log('CDN Asset Pull for sogni-chat');
  console.log('============================\n');

  checkPrerequisites();

  // Ensure local directory exists
  if (!existsSync(ASSETS_DIR)) {
    console.log('Creating local-scripts/assets/ directory...\n');
    mkdirSync(ASSETS_DIR, { recursive: true });
  }

  // List what's on R2
  console.log('Checking R2 for available assets...');
  let remoteFiles;
  try {
    const output = execSync(
      `rclone lsjson "${R2_REMOTE}/" --recursive --no-modtime --no-mimetype`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    remoteFiles = JSON.parse(output).filter((e) => !e.IsDir);
  } catch (e) {
    console.error('Error listing remote files:', e.message);
    process.exit(1);
  }

  const totalSize = remoteFiles.reduce((s, f) => s + f.Size, 0);
  console.log(
    `Found ${remoteFiles.length} assets on R2 (${(totalSize / 1024 / 1024).toFixed(1)} MB)\n`
  );

  // Build rclone flags
  const rcloneFlags = FORCE ? '' : '--size-only';

  if (DRY_RUN) {
    console.log('[DRY RUN] Would download to:', ASSETS_DIR);
    console.log(`[DRY RUN] rclone copy "${R2_REMOTE}/" "${ASSETS_DIR}/" ${rcloneFlags}\n`);

    try {
      const output = execSync(
        `rclone copy "${R2_REMOTE}/" "${ASSETS_DIR}/" ${rcloneFlags} --dry-run 2>&1`,
        { encoding: 'utf-8', timeout: 60000 }
      );
      if (output.trim()) {
        console.log(output);
      } else {
        console.log('All files already up to date locally.');
      }
    } catch (e) {
      if (e.stdout) console.log(e.stdout);
      if (e.stderr) console.log(e.stderr);
    }
    return;
  }

  const answer = await prompt(
    `Download assets from R2 to local-scripts/assets/? (y/n) `
  );
  if (answer !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }

  console.log('\nDownloading assets from R2...\n');

  try {
    execSync(
      `rclone copy "${R2_REMOTE}/" "${ASSETS_DIR}/" ${rcloneFlags} --progress`,
      { stdio: 'inherit', timeout: 600000 }
    );
    console.log('\nDone! Assets downloaded to local-scripts/assets/');
  } catch (e) {
    console.error('\nDownload failed:', e.message);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
