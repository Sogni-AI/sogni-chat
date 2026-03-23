/**
 * Hook for changelog state — entries, new-version detection, modal control.
 */

import { useState, useCallback, useMemo } from 'react';
import changelogEntries from 'virtual:changelog';
import { getAppVersion } from '@/config/env';
import {
  getLastSeenVersion,
  markVersionSeen,
  hasUnseenUpdates,
} from '@/services/changelogService';

export interface ChangelogChange {
  type: string;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: ChangelogChange[];
}

export function useChangelog() {
  const currentVersion = getAppVersion();
  const changelog = changelogEntries as ChangelogEntry[];

  const [seen, setSeen] = useState(() => !hasUnseenUpdates(currentVersion));
  const [isModalOpen, setIsModalOpen] = useState(false);

  const hasNew = !seen;

  const newEntries = useMemo(() => {
    const lastSeen = getLastSeenVersion();
    if (!lastSeen) return changelog;
    const idx = changelog.findIndex((e) => e.version === lastSeen);
    if (idx <= 0) return changelog;
    return changelog.slice(0, idx);
  }, [changelog]);

  const openChangelog = useCallback(() => {
    markVersionSeen(currentVersion);
    setSeen(true);
    setIsModalOpen(true);
  }, [currentVersion]);

  const closeChangelog = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return { changelog, newEntries, hasNew, isModalOpen, openChangelog, closeChangelog };
}
