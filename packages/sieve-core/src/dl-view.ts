import type { DlRecord } from './dl-record.ts';
import type { CategoryId, DownloadSettings, QueueSetting } from './dl-settings.ts';
import { T } from './dl-text.ts';

export { plural } from './dl-text.ts';

const UNITS = ['KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1000) return `${Math.floor(n)} B`;
  let v = n / 1000;
  let u = 0;
  // 999.5 KB rounds to 1000, so it moves up a unit and reads 1.0 MB
  while (Math.round(v) >= 1000 && u < UNITS.length - 1) { v /= 1000; u++; }
  return `${v < 9.95 ? v.toFixed(1) : Math.round(v)} ${UNITS[u]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '';
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const s = Math.floor(Math.max(0, seconds));
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

const doneBytes = (r: DlRecord) => r.parts.reduce((a, p) => a + p.done, 0);

export function progressOf(r: DlRecord): { done: number; total: number | null; percent: number | null } {
  const done = doneBytes(r);
  const total = r.size;
  // deviation from the plan, accepted: a done record reports its size as done, even when its parts were cleared
  if (r.state === 'done') return { done: total ?? done, total, percent: 100 };
  if (total === null) return { done, total, percent: null };
  return { done, total, percent: total === 0 ? 100 : Math.min(100, Math.max(0, Math.floor((done * 100) / total))) };
}

export function etaSeconds(r: DlRecord, speed: number): number | null {
  if (r.size === null || !(speed > 0) || !Number.isFinite(speed)) return null;
  return Math.max(0, r.size - doneBytes(r)) / speed;
}

export type SidebarFilter = { kind: 'all' } | { kind: 'unfinished' } | { kind: 'finished' } | { kind: 'category'; id: CategoryId } | { kind: 'queue'; id: string };

export function filterRecords(records: readonly DlRecord[], f: SidebarFilter): DlRecord[] {
  return records.filter((r) => {
    switch (f.kind) {
      case 'all': return true;
      case 'unfinished': return r.state !== 'done';
      case 'finished': return r.state === 'done';
      case 'category': return r.category === f.id;
      case 'queue': return r.queue === f.id;
    }
  });
}

export type SortKey = 'added' | 'name' | 'size' | 'progress' | 'speed' | 'eta';

export function sortRecords(records: readonly DlRecord[], key: SortKey, dir: 'asc' | 'desc', speeds: Readonly<Record<string, number>>): DlRecord[] {
  const val = (r: DlRecord): number | string | null => {
    switch (key) {
      case 'added': return r.addedAt;
      case 'name': return r.name;
      case 'size': return r.size;
      case 'progress': return progressOf(r).percent;
      case 'speed': return speeds[r.id] ?? 0;
      case 'eta': return etaSeconds(r, speeds[r.id] ?? 0);
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // nulls last in both directions
    const c = typeof x === 'string' ? x.localeCompare(y as string, 'en', { numeric: true, sensitivity: 'base' }) : x - (y as number);
    return c * sign;
  });
}

export function parseAddInput(text: string, max = 200): { urls: string[]; skipped: number; truncated: boolean } {
  const urls: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let truncated = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let href: string | null = null;
    try {
      const u = new URL(line);
      if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
    } catch { /* not a URL */ }
    if (href === null) skipped++;
    else if (!seen.has(href)) {
      seen.add(href);
      if (urls.length < max) urls.push(href);
      else truncated = true;
    }
  }
  return { urls, skipped, truncated };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function statusText(r: DlRecord, queues: readonly QueueSetting[], categories: DownloadSettings['categories'], at: Date, nextOpenAt: (q: QueueSetting, at: Date) => number | null): string {
  switch (r.state) {
    case 'queued': {
      const q = queues.find((x) => x.id === r.queue) ?? queues[0]; // the scheduler runs an unknown queue under the first one
      const open = q ? nextOpenAt(q, at) : null;
      if (open === null) return T.st.waiting(q?.name ?? r.queue);
      const d = new Date(open);
      return T.st.scheduled(`${T.days[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    case 'running': return r.size === null ? T.st.starting : T.st.downloading;
    case 'paused': return T.st.paused;
    case 'saving': return T.st.saving;
    case 'done': return T.st.done(categories.find((c) => c.id === r.category)?.folder ?? T.categoryNames[r.category]);
    case 'failed': return r.error ?? T.st.failed;
  }
}
