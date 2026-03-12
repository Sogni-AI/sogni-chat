# Local Scripts - CDN Asset Management

Upload and download sample gallery assets to/from Cloudflare R2.

## Prerequisites

1. Install rclone: https://rclone.org/install/
2. Configure the R2 remote:
   ```bash
   rclone config
   ```
   - Name: `sogni-r2`
   - Type: `s3`
   - Provider: `Cloudflare`
   - Access Key ID: (from team)
   - Secret Access Key: (from team)
   - Endpoint: `https://<account-id>.r2.cloudflarestorage.com`

## Getting Started (New Developers)

Pull all assets from R2 to your local machine:

```bash
node local-scripts/pull-assets.js
```

This downloads everything from R2 into `local-scripts/assets/`. It skips files you already have locally (by size). Use `--force` to re-download everything.

## Uploading Assets

```bash
# Upload new/changed assets and regenerate manifest
node local-scripts/sync-assets.js

# Force re-upload all assets
node local-scripts/sync-assets.js --force

# Preview what would be uploaded (no changes made)
node local-scripts/sync-assets.js --dry-run

# Regenerate manifest only (no upload, no rclone needed)
node local-scripts/sync-assets.js --manifest
```

## Downloading Assets

```bash
# Download missing assets from R2
node local-scripts/pull-assets.js

# Re-download all assets (overwrite local)
node local-scripts/pull-assets.js --force

# Preview what would be downloaded
node local-scripts/pull-assets.js --dry-run
```

## Directory Structure

Place assets in `local-scripts/assets/` mirroring the CDN structure:

```
assets/
  images/          -> cdn.sogni.ai/sogni-chat/images/
  videos/          -> cdn.sogni.ai/sogni-chat/videos/
  audio/           -> cdn.sogni.ai/sogni-chat/audio/
```

Subfolders are supported and will create nested objects in the manifest:

```
assets/
  images/
    gallery/       -> cdnAssets.images.gallery.filename
    samples/       -> cdnAssets.images.samples.filename
  videos/
    demos/         -> cdnAssets.videos.demos.filename
```

## Adding New Assets

1. Place files in the appropriate `assets/` subdirectory
2. Run `node local-scripts/sync-assets.js`
3. The script uploads new files to R2 and regenerates `src/assets/cdn.ts`
4. Commit the updated `src/assets/cdn.ts`

## Adding New Asset Categories

Edit `FOLDER_CONFIG` in `sync-assets.js` to add new top-level folders:

```js
const FOLDER_CONFIG = {
  videos: { type: 'object' },
  images: { type: 'object' },
  audio: { type: 'object' },
  // Add new categories here:
  thumbnails: { type: 'object' },
};
```

## How It Works

The script:
1. Scans `local-scripts/assets/` for all files
2. Compares against what's already on R2 (skips existing unless `--force`)
3. Uploads new files via `rclone copy`
4. Regenerates `src/assets/cdn.ts` from the local directory structure
5. Logs uploads to `completed.csv` for audit tracking

## Notes

- `local-scripts/assets/` and `completed.csv` are gitignored
- `src/assets/cdn.ts` IS committed (it's the app's reference to all CDN URLs)
- Asset keys in the manifest are camelCase, derived from filenames
- Subfolders create nested objects automatically
