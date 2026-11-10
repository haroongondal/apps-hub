import type { CategoryId, CategorySetting, TakeOverSetting } from './dl-settings.ts';

export interface ChromeItem { url: string; finalUrl: string; referrer: string; mime: string; totalBytes: number; byExtensionId?: string; filename?: string }   // filename: Chrome's absolute path, '' in onCreated, filled after pause (inspected F11)

export const SPACE_MARGIN = 50_000_000;   // free space kept beyond what a file needs; the engine (Task 3.8) imports it

export type WantReason = 'off' | 'not-http' | 'unknown-size' | 'too-small' | 'type';

export interface ProbeFacts {
  error?: string;                                  // the fetch threw, timed out or was blocked
  status: number; url: string;                     // url is the final URL after redirects
  contentRange: string | null; contentEncoding: string | null; mime: string | null;
  etag: string | null; lastModified: string | null; disposition: string | null; contentLength: string | null;
}

export type LeaveReason = 'probe-failed' | 'no-range' | `status-${number}` | 'encoded' | 'no-size' | 'size-differs' | 'type-differs' | 'no-space';
export type Verdict =
  | { take: true; size: number; mime: string; validator: string | null; finalUrl: string; name: string }
  | { take: false; reason: LeaveReason };

export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-7z-compressed': '7z',
  'application/x-apple-diskimage': 'dmg',
  'application/vnd.android.package-archive': 'apk',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
};

export function isOurs(_item: Pick<ChromeItem, 'url' | 'finalUrl' | 'byExtensionId'>, _extensionId: string, _retryUrls: readonly string[]): boolean { throw new Error('not implemented'); }
export function extensionOf(_name: string): string { throw new Error('not implemented'); }
export function urlFileName(_url: string): string { throw new Error('not implemented'); }
export function normaliseMime(_mime: string | null | undefined): string { throw new Error('not implemented'); }
export function mimeMatches(_mime: string, _patterns: readonly string[]): boolean { throw new Error('not implemented'); }
export function wantsTakeover(_item: ChromeItem, _s: TakeOverSetting, _downloadsOn: boolean): { want: true } | { want: false; reason: WantReason } { throw new Error('not implemented'); }
export function factsFromResponse(_r: { status: number; url: string; headers: { get(name: string): string | null } }): ProbeFacts { throw new Error('not implemented'); }
export function factsFromError(_message: string, _url: string): ProbeFacts { throw new Error('not implemented'); }   // status 0
export function parseRangeTotal(_contentRange: string | null): number | null { throw new Error('not implemented'); }
export function verdict(_item: ChromeItem, _probe: ProbeFacts, _freeBytes: number | null): Verdict { throw new Error('not implemented'); }   // freeBytes: quota minus usage from navigator.storage.estimate() (inspected F6), null when unknown
export function validatorOf(_facts: Pick<ProbeFacts, 'etag' | 'lastModified'>): string | null { throw new Error('not implemented'); }
export function parseDisposition(_header: string | null): string | null { throw new Error('not implemented'); }
export function sanitizeFileName(_raw: string): string { throw new Error('not implemented'); }
export function chooseName(_parts: { chromeFilename?: string | null; disposition: string | null; url: string; mime: string }): string { throw new Error('not implemented'); }
export function categoryOf(_name: string, _mime: string, _categories: readonly CategorySetting[]): CategoryId { throw new Error('not implemented'); }
export function savePath(_category: CategorySetting, _name: string): string { throw new Error('not implemented'); }   // `${folder}/${name}`
