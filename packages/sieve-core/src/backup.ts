import { isRecord, validateSettings, type Settings } from './settings.ts';
import { validateYouTube, type YouTubeSettings } from './youtube-settings.ts';

export const BACKUP_MAX_CHARS = 64 * 1024 * 1024;
export const BACKUP_TOO_BIG = 'This file is too big to be a Sieve backup.';
const NOT_BACKUP = "This file isn't a Sieve backup.";

export interface Backup { app: 'sieve'; version: 1; exportedAt: string; settings: Settings; youtube: YouTubeSettings }
export type ReadResult = { ok: true; settings: Settings; youtube: YouTubeSettings } | { ok: false; reason: string };

export const makeBackup = (settings: Settings, youtube: YouTubeSettings, now: Date): Backup => ({ app: 'sieve', version: 1, exportedAt: now.toISOString(), settings, youtube });

export function readBackup(text: string): ReadResult {
  const no = (reason: string): ReadResult => ({ ok: false, reason });
  if (text.length > BACKUP_MAX_CHARS) return no(BACKUP_TOO_BIG);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return no(`${NOT_BACKUP.slice(0, -1)}: it isn't valid JSON.`);
  }
  if (!isRecord(data) || data.app !== 'sieve') return no(NOT_BACKUP);
  if (typeof data.version === 'number' && data.version > 1) return no('This backup comes from a newer Sieve. Update Sieve, then import it again.');
  if (data.version !== 1) return no(NOT_BACKUP);
  return { ok: true, settings: validateSettings(data.settings), youtube: validateYouTube(data.youtube) };
}

// The local date, so a backup saved late in the evening carries that day's name.
export function backupFileName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `sieve-settings-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.json`;
}
