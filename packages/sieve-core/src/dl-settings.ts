// Download settings (key `downloads` in chrome.storage.local): types, defaults and validation. Pure.

export const DOWNLOADS_KEY = 'downloads';
export const CATEGORY_IDS = ['video', 'music', 'programs', 'archives', 'documents', 'other'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export interface CategorySetting { id: CategoryId; folder: string; extensions: string[] }
export interface Schedule { on: boolean; days: number[]; start: string; stop: string | null }   // days 0 to 6 (Sunday 0); 'HH:MM', 24 hours, local time
export interface QueueSetting { id: string; name: string; maxParallel: number; schedule: Schedule }
export interface TakeOverSetting { on: boolean; minMb: number; extensions: string[]; mimeTypes: string[] }
export interface DownloadSettings {
  version: 1;
  on: boolean;                                       // the Downloads switch
  takeOver: TakeOverSetting;
  parts: number;                                     // parts per file, 1 to 6
  speedLimit: { on: boolean; kbPerSecond: number };  // 1 KB = 1000 bytes
  categories: CategorySetting[];                     // always 6, in CATEGORY_IDS order
  queues: QueueSetting[];                            // 1 to 8; the first is the default queue
}

export const MAX_QUEUES = 8;

const VIDEO = ['mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mpg', 'mpeg', 'm2ts', '3gp'];
const MUSIC = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma', 'aiff'];
const PROGRAMS = ['dmg', 'pkg', 'exe', 'msi', 'apk', 'ipa', 'deb', 'rpm', 'appimage', 'iso', 'img'];
const ARCHIVES = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab'];
const DOCUMENTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'epub', 'mobi'];

export const DEFAULT_TAKEOVER_EXTENSIONS: readonly string[] = [...VIDEO, ...MUSIC, ...PROGRAMS, ...ARCHIVES, ...DOCUMENTS];

export const DEFAULT_TAKEOVER_MIME_TYPES: readonly string[] = [
  'application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
  'application/vnd.rar', 'application/x-7z-compressed', 'application/gzip', 'application/x-gzip', 'application/x-tar',
  'application/x-bzip2', 'application/x-xz', 'application/zstd', 'application/x-apple-diskimage',
  'application/x-iso9660-image', 'application/x-msdownload', 'application/vnd.microsoft.portable-executable',
  'application/x-msi', 'application/vnd.android.package-archive', 'application/vnd.debian.binary-package',
  'application/x-rpm', 'application/x-newton-compatible-pkg', 'video/*', 'audio/*', 'application/pdf',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.*', 'application/vnd.oasis.opendocument.*', 'application/rtf',
  'application/epub+zip',
];

export const DEFAULT_CATEGORIES: readonly CategorySetting[] = [
  { id: 'video', folder: 'Video', extensions: VIDEO },
  { id: 'music', folder: 'Music', extensions: MUSIC },
  { id: 'programs', folder: 'Programs', extensions: PROGRAMS },
  { id: 'archives', folder: 'Archives', extensions: ARCHIVES },
  { id: 'documents', folder: 'Documents', extensions: DOCUMENTS },
  { id: 'other', folder: 'Other', extensions: [] },
];

export const DEFAULT_DOWNLOADS: DownloadSettings = {
  version: 1,
  on: true,
  takeOver: { on: true, minMb: 5, extensions: [...DEFAULT_TAKEOVER_EXTENSIONS], mimeTypes: [...DEFAULT_TAKEOVER_MIME_TYPES] },
  parts: 1,
  speedLimit: { on: false, kbPerSecond: 1000 },
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, extensions: [...c.extensions] })),
  queues: [{ id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }],
};

// Never throws; idempotent. Rules: docs/superpowers/plans/2026-11-10-sieve-phase-3.md, Task 3.1.
export function validateDownloadSettings(_input: unknown): DownloadSettings {
  throw new Error('not implemented');
}
