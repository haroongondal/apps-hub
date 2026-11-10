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

const copy = (): DownloadSettings => structuredClone(DEFAULT_DOWNLOADS);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
const num = (x: unknown, lo: number, hi: number, d: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;

function list(x: unknown, ok: RegExp, clean: (s: string) => string, max: number, d: readonly string[]): string[] {
  if (!Array.isArray(x)) return [...d];
  const out: string[] = [];
  for (const e of x) {
    if (typeof e !== 'string') continue;
    const s = clean(e);
    if (ok.test(s) && !out.includes(s)) out.push(s);
    if (out.length === max) break;
  }
  return out;
}
const EXT = /^[a-z0-9]{1,10}$/;
const MIME = /^[a-z0-9][a-z0-9.+-]*\/([a-z0-9][a-z0-9.+-]*\*?|\*)$/;
const extensions = (x: unknown, max: number, d: readonly string[]) => list(x, EXT, (s) => s.trim().toLowerCase().replace(/^\.+/, ''), max, d);
const FOLDER_BAD = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function category(id: CategoryId, input: unknown[]): CategorySetting {
  const d = DEFAULT_CATEGORIES.find((c) => c.id === id)!;
  const e = input.find((c) => isObj(c) && c.id === id) as Record<string, unknown> | undefined;
  if (!e) return { id, folder: d.folder, extensions: [...d.extensions] };
  const f = typeof e.folder === 'string' ? e.folder.trim() : '';
  const folder = f.length >= 1 && f.length <= 40 && !FOLDER_BAD.test(f) && !f.startsWith('.') ? f : d.folder;
  return { id, folder, extensions: id === 'other' ? [] : extensions(e.extensions, 100, d.extensions) };
}

function queues(input: unknown): QueueSetting[] {
  if (!Array.isArray(input) || input.length === 0) return copy().queues;
  const used = new Set<string>();
  return input.slice(0, MAX_QUEUES).map((raw, i) => {
    const q = isObj(raw) ? raw : {};
    const pos = i + 1;
    let id = typeof q.id === 'string' && /^[a-z0-9-]{1,24}$/.test(q.id) && !used.has(q.id) ? q.id : '';
    for (let n = pos; !id; n++) if (!used.has(`q${n}`)) id = `q${n}`;
    used.add(id);
    const name = typeof q.name === 'string' ? q.name.trim() : '';
    const s = isObj(q.schedule) ? q.schedule : {};
    const days = Array.isArray(s.days)
      ? [...new Set(s.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      : [];
    return {
      id,
      name: name.length >= 1 && name.length <= 40 ? name : `Queue ${pos}`,
      maxParallel: num(q.maxParallel, 1, 8, 3),
      schedule: {
        on: bool(s.on, false),
        days: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
        start: typeof s.start === 'string' && TIME.test(s.start) ? s.start : '00:00',
        stop: typeof s.stop === 'string' && TIME.test(s.stop) ? s.stop : null,
      },
    };
  });
}

// Never throws; idempotent. Rules: docs/superpowers/plans/2026-11-10-sieve-phase-3.md, Task 3.1.
export function validateDownloadSettings(input: unknown): DownloadSettings {
  if (!isObj(input) || input.version !== 1) return copy();
  const t = isObj(input.takeOver) ? input.takeOver : {};
  const sl = isObj(input.speedLimit) ? input.speedLimit : {};
  const cats = Array.isArray(input.categories) ? input.categories : [];
  return {
    version: 1,
    on: bool(input.on, true),
    takeOver: {
      on: bool(t.on, true),
      minMb: num(t.minMb, 0, 100000, 5),
      extensions: extensions(t.extensions, 200, DEFAULT_TAKEOVER_EXTENSIONS),
      mimeTypes: list(t.mimeTypes, MIME, (s) => s.trim().toLowerCase(), 100, DEFAULT_TAKEOVER_MIME_TYPES),
    },
    parts: num(input.parts, 1, 6, 1),
    speedLimit: { on: bool(sl.on, false), kbPerSecond: num(sl.kbPerSecond, 10, 1_000_000, 1000) },
    categories: CATEGORY_IDS.map((id) => category(id, cats)),
    queues: queues(input.queues),
  };
}
