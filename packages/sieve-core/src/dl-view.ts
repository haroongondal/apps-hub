import type { DlRecord } from './dl-record.ts';
import type { CategoryId, DownloadSettings, QueueSetting } from './dl-settings.ts';

export { plural } from './dl-text.ts';

export function formatBytes(n: number): string {
  throw new Error('not implemented');
}

export function formatSpeed(bytesPerSecond: number): string {
  throw new Error('not implemented');
}

export function formatEta(seconds: number | null): string {
  throw new Error('not implemented');
}

export function progressOf(r: DlRecord): { done: number; total: number | null; percent: number | null } {
  throw new Error('not implemented');
}

export function etaSeconds(r: DlRecord, speed: number): number | null {
  throw new Error('not implemented');
}

export type SidebarFilter = { kind: 'all' } | { kind: 'unfinished' } | { kind: 'finished' } | { kind: 'category'; id: CategoryId } | { kind: 'queue'; id: string };

export function filterRecords(records: readonly DlRecord[], f: SidebarFilter): DlRecord[] {
  throw new Error('not implemented');
}

export type SortKey = 'added' | 'name' | 'size' | 'progress' | 'speed' | 'eta';

export function sortRecords(records: readonly DlRecord[], key: SortKey, dir: 'asc' | 'desc', speeds: Readonly<Record<string, number>>): DlRecord[] {
  throw new Error('not implemented');
}

export function parseAddInput(text: string, max?: number): { urls: string[]; skipped: number; truncated: boolean } {
  throw new Error('not implemented');
}

export function statusText(r: DlRecord, queues: readonly QueueSetting[], categories: DownloadSettings['categories'], at: Date, nextOpenAt: (q: QueueSetting, at: Date) => number | null): string {
  throw new Error('not implemented');
}
