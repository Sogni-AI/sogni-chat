/**
 * Vite plugin that exposes a virtual module `virtual:changelog`.
 *
 * At build time it reads CHANGELOG.md and parses changelogen-formatted
 * entries into structured JSON:
 *
 *   { version: string; date: string; changes: { type: string; text: string }[] }[]
 *
 * Portable — copy this file into any Vite project.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const VIRTUAL_ID = 'virtual:changelog';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Map changelogen subsection headings to display labels.
 */
const TYPE_MAP = {
  'features': 'NEW',
  'bug fixes': 'FIXED',
  'fixes': 'FIXED',
  'performance': 'IMPROVED',
  'improvements': 'IMPROVED',
  'refactors': 'IMPROVED',
  'documentation': 'DOCS',
  'chores': 'CHORE',
};

/**
 * Parse a changelogen-formatted CHANGELOG.md into structured entries.
 */
function parseChangelog(md) {
  const entries = [];
  let current = null;
  let currentType = 'NEW';

  for (const line of md.split('\n')) {
    // Version heading: ## v1.2.0 or ## 1.2.0 — optionally with date
    const versionMatch = line.match(/^## v?(\d+\.\d+\.\d+)(?:.*?\((\d{4}-\d{2}-\d{2})\))?/);
    if (versionMatch) {
      if (current) entries.push(current);
      current = {
        version: versionMatch[1],
        date: versionMatch[2] || '',
        changes: [],
      };
      currentType = 'NEW';
      continue;
    }

    if (!current) continue;

    // Subsection heading: ### Features, ### Bug Fixes, etc.
    const sectionMatch = line.match(/^### (.+)/);
    if (sectionMatch) {
      const key = sectionMatch[1].toLowerCase().trim();
      currentType = TYPE_MAP[key] || 'OTHER';
      continue;
    }

    // List item: - Some change text
    const itemMatch = line.match(/^[-*]\s+(.+)/);
    if (itemMatch) {
      current.changes.push({ type: currentType, text: itemMatch[1].trim() });
    }
  }

  if (current) entries.push(current);
  return entries;
}

export default function changelogPlugin() {
  return {
    name: 'vite-plugin-changelog',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const changelogPath = resolve(process.cwd(), 'CHANGELOG.md');
      if (!existsSync(changelogPath)) {
        return `export default [];`;
      }

      const md = readFileSync(changelogPath, 'utf-8');
      const entries = parseChangelog(md);
      return `export default ${JSON.stringify(entries)};`;
    },
  };
}
