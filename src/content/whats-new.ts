import { CHANGELOG, type ChangelogEntry } from './changelog';

/** Compares "1.2.10" with "1.2.9" numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Whether to show the "What's new" notice. Never on a fresh install (nothing seen yet: the
 * first-run page already explains the app), only after an update to a version that has notes.
 */
export function shouldShowWhatsNew(
  lastSeen: string | null,
  current: string | null,
  log: ChangelogEntry[] = CHANGELOG,
): boolean {
  if (!lastSeen || !current) return false;
  if (compareVersions(current, lastSeen) <= 0) return false;
  return entriesSince(lastSeen, current, log).length > 0;
}

/** Entries newer than `lastSeen` up to and including `current`, newest first. */
export function entriesSince(
  lastSeen: string | null,
  current: string,
  log: ChangelogEntry[] = CHANGELOG,
): ChangelogEntry[] {
  return log.filter(
    (e) =>
      compareVersions(e.version, current) <= 0 &&
      (lastSeen == null || compareVersions(e.version, lastSeen) > 0),
  );
}

/** Play Store "What's new" text for one version: bullet lines, at most 500 characters. */
export function playStoreText(entry: ChangelogEntry, max = 500): string {
  const lines: string[] = [];
  for (const item of entry.items) {
    const next = [...lines, `• ${item}`].join('\n');
    if (next.length > max) break;
    lines.push(`• ${item}`);
  }
  return lines.join('\n');
}
