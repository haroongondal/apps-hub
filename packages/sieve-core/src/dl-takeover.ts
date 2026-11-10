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

const isHttp = (u: string): boolean => /^https?:/i.test(u);

export function isOurs(item: Pick<ChromeItem, 'url' | 'finalUrl' | 'byExtensionId'>, extensionId: string, retryUrls: readonly string[]): boolean {
  if (!isHttp(item.url) || (item.finalUrl !== '' && !isHttp(item.finalUrl))) return true;   // blob:, data:, filesystem:
  if (item.byExtensionId === extensionId) return true;   // often absent at onCreated (inspected F9), so only a second guard
  return retryUrls.includes(item.url) || retryUrls.includes(item.finalUrl);
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 || i === name.length - 1 ? '' : name.slice(i + 1).toLowerCase();
}

export function urlFileName(url: string): string {
  let last: string;
  try { last = new URL(url).pathname.split('/').pop() ?? ''; } catch { return ''; }
  try { return decodeURIComponent(last); } catch { return last; }
}

export function normaliseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

export function mimeMatches(mime: string, patterns: readonly string[]): boolean {
  const m = normaliseMime(mime);
  if (m === '') return false;
  return patterns.some((p) => (p.endsWith('*') ? m.startsWith(p.slice(0, -1)) : m === p));
}

export function wantsTakeover(item: ChromeItem, s: TakeOverSetting, downloadsOn: boolean): { want: true } | { want: false; reason: WantReason } {
  if (!downloadsOn || !s.on) return { want: false, reason: 'off' };
  if (!isHttp(item.url) || (item.finalUrl !== '' && !isHttp(item.finalUrl))) return { want: false, reason: 'not-http' };
  if (!Number.isFinite(item.totalBytes) || item.totalBytes < 0) return { want: false, reason: 'unknown-size' };
  if (item.totalBytes <= s.minMb * 1_000_000) return { want: false, reason: 'too-small' };
  if (s.extensions.includes(extensionOf(urlFileName(item.finalUrl || item.url))) || mimeMatches(item.mime, s.mimeTypes)) return { want: true };
  return { want: false, reason: 'type' };
}

export function factsFromResponse(r: { status: number; url: string; headers: { get(name: string): string | null } }): ProbeFacts {
  const h = (n: string) => r.headers.get(n);
  return {
    status: r.status, url: r.url, contentRange: h('content-range'), contentEncoding: h('content-encoding'), mime: h('content-type'),
    etag: h('etag'), lastModified: h('last-modified'), disposition: h('content-disposition'), contentLength: h('content-length'),
  };
}

export function factsFromError(message: string, url: string): ProbeFacts {
  return {
    error: message, status: 0, url, contentRange: null, contentEncoding: null, mime: null,
    etag: null, lastModified: null, disposition: null, contentLength: null,
  };
}

export function parseRangeTotal(contentRange: string | null): number | null {
  const m = /^bytes\s+\d+-\d+\/(\d+)$/i.exec((contentRange ?? '').trim());
  return m ? Number(m[1]) : null;
}

export function validatorOf(facts: Pick<ProbeFacts, 'etag' | 'lastModified'>): string | null {
  if (facts.etag && !/^W\//i.test(facts.etag.trim())) return facts.etag;
  return facts.lastModified || null;
}

export function verdict(item: ChromeItem, probe: ProbeFacts, freeBytes: number | null): Verdict {
  const leave = (reason: LeaveReason): Verdict => ({ take: false, reason });
  if (probe.error !== undefined) return leave('probe-failed');
  if (probe.status === 200) return leave('no-range');
  if (probe.status !== 206) return leave(`status-${probe.status}`);
  // Unreachable through fetch (inspected F17: a ranged request sends Accept-Encoding: identity and fetch throws on an
  // encoded answer, which is the probe-failed row); kept as a guard.
  if (probe.contentEncoding !== null && probe.contentEncoding.trim().toLowerCase() !== 'identity') return leave('encoded');
  const size = parseRangeTotal(probe.contentRange);
  if (size === null) return leave('no-size');
  if (size !== item.totalBytes) return leave('size-differs');
  const mime = normaliseMime(probe.mime);
  if (item.mime !== '' && normaliseMime(item.mime) !== mime) return leave('type-differs');
  if (freeBytes !== null && freeBytes < 2 * size + SPACE_MARGIN) return leave('no-space');   // private copy plus the saved file
  return {
    take: true, size, mime, validator: validatorOf(probe), finalUrl: probe.url,
    name: chooseName({ chromeFilename: item.filename, disposition: probe.disposition, url: probe.url, mime }),
  };
}

export function parseDisposition(header: string | null): string | null {
  if (!header) return null;
  // shortcut: only UTF-8 in filename*; other charsets fall back to filename=, upgrade if a server needs it
  const star = /(?:^|[;\s])filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const m = /^\s*utf-8'[^']*'(.*?)\s*$/i.exec(star[1]);
    if (m) { try { const v = decodeURIComponent(m[1]); if (v) return v; } catch { /* fall back to filename= */ } }
  }
  const quoted = /(?:^|[;\s])filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1].replace(/\\(.)/g, '$1') || null;
  const bare = /(?:^|[;\s])filename\s*=\s*([^;\s]+)/i.exec(header);
  return bare ? bare[1] : null;
}

export function sanitizeFileName(raw: string): string {
  let s = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1).normalize('NFC');
  s = s.replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (s === '') return 'download';
  if (s.length > 150) {
    const dot = s.lastIndexOf('.');
    const ext = dot >= 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 150 - ext.length).trimEnd() + ext;
  }
  return s;
}

export function chooseName(parts: { chromeFilename?: string | null; disposition: string | null; url: string; mime: string }): string {
  const chrome = (parts.chromeFilename ?? '').replace(/^.*[/\\]/, '').replace(/\.crdownload$/i, '');
  const raw = (extensionOf(chrome) !== '' ? chrome : '') || parseDisposition(parts.disposition) || urlFileName(parts.url);
  const name = sanitizeFileName(raw);
  const ext = MIME_EXTENSIONS[normaliseMime(parts.mime)];
  return extensionOf(name) === '' && ext ? `${name}.${ext}` : name;
}

export function categoryOf(name: string, mime: string, categories: readonly CategorySetting[]): CategoryId {
  const ext = extensionOf(name);
  const hit = ext === '' ? undefined : categories.find((c) => c.extensions.includes(ext));
  if (hit) return hit.id;
  const m = normaliseMime(mime);
  return m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'music' : 'other';
}

export function savePath(category: CategorySetting, name: string): string {
  return `${category.folder}/${name}`;
}
