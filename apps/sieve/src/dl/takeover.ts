import type { AddItem, DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import type { ChromeItem, ProbeFacts } from '@apps-hub/sieve-core/src/dl-takeover.ts';

export interface AreaLike {                                        // chrome.storage.local or chrome.storage.session
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
export interface TakeoverDeps {
  extensionId: string;
  settings(): Promise<DownloadSettings>;
  pause(id: number): Promise<void>; resume(id: number): Promise<void>; cancel(id: number): Promise<void>; erase(id: number): Promise<void>;
  search(id: number): Promise<{ state: string; paused: boolean; filename: string } | undefined>;
  freeBytes(): Promise<number | null>;
  probe(item: ChromeItem): Promise<ProbeFacts>;                     // never throws
  add(items: AddItem[]): Promise<{ ids: string[] } | null>;
  records(): Promise<DlRecord[]>;
  remove(ids: string[]): Promise<void>;
  local: AreaLike; session: AreaLike;
  now(): number;
  startedAt: number;
}
export interface RetryDeps {
  records(): Promise<DlRecord[]>;
  download(url: string): Promise<number>;
  search(id: number): Promise<{ state: string; bytesReceived: number } | undefined>;
  remove(ids: string[]): Promise<void>;
  session: AreaLike; now(): number; sleep(ms: number): Promise<void>;
}

// Contract stubs (Task 3.13 fills them in).
export async function onCreated(_item: chrome.downloads.DownloadItem, _deps?: TakeoverDeps): Promise<void> {
  throw new Error('not implemented');
}
export async function recoverPaused(_deps?: TakeoverDeps): Promise<void> {
  throw new Error('not implemented');
}
export async function retryInChrome(_id: string, _deps?: RetryDeps): Promise<{ ok: boolean; message?: string }> {
  throw new Error('not implemented');
}
export async function realProbe(_item: ChromeItem): Promise<ProbeFacts> {
  throw new Error('not implemented');
}
export function initTakeover(): void {}
