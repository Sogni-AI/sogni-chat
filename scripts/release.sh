#!/bin/bash
set -e

npx changelogen --bump --output CHANGELOG.md
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
git add CHANGELOG.md package.json
git commit -m "chore(release): v${VERSION}"
git tag "v${VERSION}"
echo "Released v${VERSION}. Now run: npm run deploy:production"
