// Everything in a share is untrusted data from another app: classified and shown as plain text, never followed or evaluated.

export type Sniffed =
  | 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic' | 'gif'
  | 'ogg' | 'mp3' | 'wav' | 'flac' | 'mp4' | 'webm' | '3gp' | 'amr' | 'aac'
  | 'unknown';

export interface SharedFile {
  file: string | null;
  name: string;
  mime: string;
  sniffed: Sniffed;
  size: number;
  refused: 'too-big' | 'unreadable' | 'not-allowed' | null;
}

export interface SharedPayload {
  createdAt: number;
  text: string | null;
  subject: string | null;
  count: number;
  files: SharedFile[];
}

export type IntakeKind = 'pdf' | 'link' | 'image' | 'note' | 'audio';

export const AUDIO_TYPES = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' } as const;
export type AudioExt = keyof typeof AUDIO_TYPES;
export const AUDIO_EXTS = Object.keys(AUDIO_TYPES) as AudioExt[];

export type IntakeEntry =
  | { ok: true; kind: 'pdf' | 'image'; label: string; name: string; title: string; file: string; size: number }
  | { ok: true; kind: 'audio'; label: string; name: string; title: string; file: string; size: number; ext: AudioExt }
  | { ok: true; kind: 'link'; label: string; name: string; title: string; url: string; text: string }
  | { ok: true; kind: 'note'; label: string; name: string; title: string; text: string }
  | { ok: false; label: string; name: string; reason: string };

export type Refusal = Extract<IntakeEntry, { ok: false }>;

export const MAX_ITEMS = 10;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 100_000;
export const LINK_EXTRA = 200;
export const INBOX_MAX_AGE_MS = 24 * 3_600_000;

const LABEL: Record<IntakeKind, string> = { pdf: 'PDF', link: 'Link', image: 'Photo', note: 'Note', audio: 'Voice recording' };

export const SAY = {
  tooMany: `You can add up to ${MAX_ITEMS} files at a time. Share fewer and try again.`,
  tooBig: `This file is over ${MAX_FILE_BYTES / 1024 / 1024} MB, too big to add.`,
  imageTooBig: `This photo is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB, too big to add.`,
  unreadable: "Nexus couldn't read this file. Try sharing it again.",
  notAllowed: 'Nexus only takes files that another app shares with it.',
  empty: 'This file is empty.',
  video: "Nexus can't add videos.",
  mislabeled: "This file isn't what it says it is, so Nexus won't add it.",
  audioKind: "Nexus can't read this kind of audio yet.",
  audioTooLong: 'This recording is over 25 MB. Nexus can cut only M4A recordings into smaller pieces, so share a shorter recording or an M4A.',
  imageKind: 'Nexus can add JPEG, PNG, WebP and HEIC photos.',
  fileKind: "Nexus can't add this kind of file.",
  textTooLong: `This text is over ${MAX_TEXT.toLocaleString('en')} characters, too long to add as a note.`,
} as const;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
// Bidi overrides and isolates can make "gpj.exe" read as "exe.jpg".
const BIDI = /[‪-‮⁦-⁩]/g;
const MAX_NAME = 80;

export function displayName(raw: string | null | undefined, fallback = 'Shared file'): string {
  const base = (raw ?? '').split(/[\\/]/).pop()!.replace(CONTROL, '').replace(BIDI, '').trim().replace(/^\.+/, '').trim();
  const chars = Array.from(base);
  if (chars.length === 0) return fallback;
  if (chars.length <= MAX_NAME) return base;
  const ext = /\.[^.\s]{1,8}$/.exec(base)?.[0] ?? '';
  return `${chars.slice(0, MAX_NAME - 1 - ext.length).join('').trimEnd()}…${ext}`;
}

export const titleOf = (name: string, fallback: string) => name.replace(/\.[^.\s]{1,8}$/, '').trim() || fallback;

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;
const HOST = /^[\p{L}\p{N}.-]+(:\d{1,5})?$/u;

export const linksIn = (text: string): string[] => (text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(TRAILING, ''));

export function isSafeLink(url: string): boolean {
  const m = /^https?:\/\/([^/?#]*)/i.exec(url);
  return !!m && m[1].length > 0 && HOST.test(m[1]) && !m[1].startsWith('.') && !m[1].startsWith('-');
}

const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

function classifyText(rawText: string, rawSubject: string | null): IntakeEntry | null {
  const text = clean(rawText).trim();
  const subject = rawSubject ? clean(rawSubject).replace(/\s+/g, ' ').trim() : '';
  if (!text) return null;
  if (text.length > MAX_TEXT) return { ok: false, label: LABEL.note, name: 'Shared text', reason: SAY.textTooLong };
  const raw = text.match(URL_IN_TEXT) ?? [];
  const links = linksIn(text);
  const rest = links.length === 1 ? text.replace(raw[0] ?? '', '').trim() : '';
  if (links.length === 1 && isSafeLink(links[0]) && rest.length <= LINK_EXTRA) {
    const url = links[0];
    const title = subject || rest.split('\n')[0].trim() || url;
    return { ok: true, kind: 'link', label: LABEL.link, name: url, title, url, text: title === url ? url : `${title}\n${url}` };
  }
  const body = subject && !text.includes(subject) ? `${subject}\n\n${text}` : text;
  return { ok: true, kind: 'note', label: LABEL.note, name: 'Shared text', title: subject || 'Shared text', text: body };
}

type Family = 'pdf' | 'image' | 'audio' | 'video' | 'text';

function mimeFamily(mime: string): Family | null {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'application/ogg') return 'audio';
  const top = m.split('/')[0];
  return top === 'image' || top === 'audio' || top === 'video' || top === 'text' ? top : null;
}

const SNIFFED_FAMILY: Record<Sniffed, Family[]> = {
  pdf: ['pdf'],
  jpeg: ['image'], png: ['image'], webp: ['image'], heic: ['image'], gif: ['image'],
  ogg: ['audio'], mp3: ['audio'], wav: ['audio'], flac: ['audio'], amr: ['audio'], aac: ['audio'],
  mp4: ['audio', 'video'], webm: ['audio', 'video'], '3gp': ['audio', 'video'],
  unknown: [],
};

const AUDIO_EXT: Partial<Record<Sniffed, AudioExt>> = { mp4: 'm4a', mp3: 'mp3', ogg: 'ogg', wav: 'wav', flac: 'flac', webm: 'webm' };
const IMAGES: Sniffed[] = ['jpeg', 'png', 'webp', 'heic'];

function classifyFile(f: SharedFile): IntakeEntry {
  const name = displayName(f.name);
  const no = (label: string, reason: string): IntakeEntry => ({ ok: false, label, name, reason });
  if (f.refused === 'too-big') return no('File', SAY.tooBig);
  if (f.refused === 'not-allowed') return no('File', SAY.notAllowed);
  if (f.refused !== null || f.file === null) return no('File', SAY.unreadable);
  if (f.size <= 0) return no('File', SAY.empty);
  const said = mimeFamily(f.mime);
  if (said === 'video') return no('Video', SAY.video);
  const families = SNIFFED_FAMILY[f.sniffed];
  if (said === 'audio' && families.length === 0) return no(LABEL.audio, SAY.audioKind);
  if ((said === 'pdf' || said === 'image') && families.length === 0) return no('File', SAY.mislabeled);
  if (families.length === 0) return no('File', SAY.fileKind);
  if (said !== null && !families.includes(said)) return no('File', SAY.mislabeled);
  const base = { name, file: f.file, size: f.size };
  if (f.sniffed === 'pdf') return { ok: true, kind: 'pdf', label: LABEL.pdf, title: titleOf(name, 'Shared PDF'), ...base };
  if (families[0] === 'image') {
    if (!IMAGES.includes(f.sniffed)) return no(LABEL.image, SAY.imageKind);
    if (f.size > MAX_IMAGE_BYTES) return no(LABEL.image, SAY.imageTooBig);
    return { ok: true, kind: 'image', label: LABEL.image, title: titleOf(name, 'Shared photo'), ...base };
  }
  const ext = AUDIO_EXT[f.sniffed];
  if (!ext) return no(LABEL.audio, SAY.audioKind);
  if (ext !== 'm4a' && f.size > MAX_UPLOAD_BYTES) return no(LABEL.audio, SAY.audioTooLong);
  return { ok: true, kind: 'audio', label: LABEL.audio, title: titleOf(name, 'Shared recording'), ext, ...base };
}

export function classifyShared(p: SharedPayload): IntakeEntry[] {
  if (p.count > MAX_ITEMS) return [{ ok: false, label: 'Files', name: `${p.count} files`, reason: SAY.tooMany }];
  const text = p.text ? classifyText(p.text, p.subject) : null;
  return [...(text ? [text] : []), ...p.files.map(classifyFile)];
}

export interface IntakeDeps<T = unknown> {
  addPdf(file: string, title: string): Promise<T>;
  addImage(file: string, title: string): Promise<T>;
  addAudio(file: string, ext: AudioExt, title: string): Promise<T>;
  addNote(text: string): Promise<T>;
  discard(): void | Promise<void>;
}

export interface IntakeResult<T = unknown> {
  added: T[];
  refused: Refusal[];
  failed: { name: string; reason: string }[];
}

type Accepted = Extract<IntakeEntry, { ok: true }>;

export function routeShared<T>(e: Accepted, deps: IntakeDeps<T>): Promise<T> {
  switch (e.kind) {
    case 'pdf':
      return deps.addPdf(e.file, e.title);
    case 'image':
      return deps.addImage(e.file, e.title);
    case 'audio':
      return deps.addAudio(e.file, e.ext, e.title);
    case 'link':
    case 'note':
      return deps.addNote(e.text);
  }
}

export async function intakeShared<T>(p: SharedPayload, deps: IntakeDeps<T>): Promise<IntakeResult<T>> {
  const result: IntakeResult<T> = { added: [], refused: [], failed: [] };
  try {
    for (const e of classifyShared(p)) {
      if (!e.ok) {
        result.refused.push(e);
        continue;
      }
      try {
        result.added.push(await routeShared(e, deps));
      } catch (err) {
        result.failed.push({ name: e.name, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    await deps.discard();
  }
  return result;
}

const INBOX_ID = /^([0-9a-z]{6,10})-[0-9a-z]{8}$/;
const FILE_NAME = /^\d{1,2}$/;

export const isInboxId = (id: unknown): id is string => typeof id === 'string' && INBOX_ID.test(id);

export function staleInboxes(names: string[], now: number): string[] {
  return names.filter((n) => {
    const m = INBOX_ID.exec(n);
    return !m || now - parseInt(m[1], 36) > INBOX_MAX_AGE_MS;
  });
}

const SNIFFED = new Set<string>(Object.keys(SNIFFED_FAMILY));
const REFUSED = new Set<unknown>([null, 'too-big', 'unreadable', 'not-allowed']);
const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => (str(v) ? v : null);

export function parseInbox(text: string): SharedPayload | null {
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (o.v !== 1 || typeof o.createdAt !== 'number' || typeof o.count !== 'number' || !Array.isArray(o.files)) return null;
    const files = o.files.slice(0, MAX_ITEMS).map((x): SharedFile => {
      const f = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      const file = str(f.file) && FILE_NAME.test(f.file) ? f.file : null;
      const size = typeof f.size === 'number' && Number.isFinite(f.size) ? f.size : 0;
      const refused = REFUSED.has(f.refused) ? (f.refused as SharedFile['refused']) : 'unreadable';
      return {
        file,
        name: displayName(optStr(f.name)),
        mime: optStr(f.mime) ?? '',
        sniffed: str(f.sniffed) && SNIFFED.has(f.sniffed) ? (f.sniffed as Sniffed) : 'unknown',
        size,
        refused: file === null && refused === null ? 'unreadable' : refused,
      };
    });
    return { createdAt: o.createdAt, text: optStr(o.text), subject: optStr(o.subject), count: o.count, files };
  } catch {
    return null;
  }
}

// The manifest may name a copy that is gone (an add moved it, a sweep removed it): that row shows as unreadable and is never added.
export const onlyExisting = (p: SharedPayload, exists: (file: string) => boolean): SharedPayload => ({
  ...p,
  files: p.files.map((f) => (f.file !== null && !exists(f.file) ? { ...f, file: null, refused: 'unreadable' } : f)),
});

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
