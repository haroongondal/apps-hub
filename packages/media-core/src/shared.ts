import { outputName } from './names.ts';

// What a shared copy really is comes from its first bytes, never from the sender's type or file name.
export const SHARE_MAX_ITEMS = 20;
export const SHARE_MAX_BYTES = 2 * 1024 ** 3;
export const SHARE_HEAD_BYTES = 16;

export type ShareKind = 'image' | 'video';
export type ShareFormat = 'jpeg' | 'png' | 'mp4' | 'matroska';
export type ShareProblem = 'unreadable' | 'too_big' | 'no_space';

export interface RawShare { uri: string; name: string; mime: string; bytes: number; head: number[]; problem?: ShareProblem | null }
export interface SharedItem { uri: string; name: string; kind: ShareKind; format: ShareFormat; bytes: number }
export interface ShareBatch {
  items: SharedItem[];
  refused: string[]; // plain sentences, one per item left out
  discard: string[]; // copies to delete: the refused ones and the repeats
}

const IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/3gpp2', 'video/x-m4v', 'video/webm', 'video/x-matroska'];
const GENERIC_MIMES = ['', '*/*', 'application/octet-stream', 'binary/octet-stream'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png'];
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', '3gp', '3g2', 'webm', 'mkv'];
const KEEP_EXTS: Record<ShareFormat, string[]> = { jpeg: ['jpg', 'jpeg'], png: ['png'], mp4: ['mp4', 'm4v', 'mov', '3gp', '3g2'], matroska: ['mkv', 'webm'] };
const DEFAULT_EXT: Record<ShareFormat, string> = { jpeg: 'jpg', png: 'png', mp4: 'mp4', matroska: 'mkv' };
const KIND_OF: Record<ShareFormat, ShareKind> = { jpeg: 'image', png: 'image', mp4: 'video', matroska: 'video' };
const PICTURE_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'];

const ascii = (head: number[], at: number, text: string) => [...text].every((ch, i) => head[at + i] === ch.charCodeAt(0));
const startsWith = (head: number[], bytes: number[]) => bytes.every((b, i) => head[i] === b);

// 'unsupported-image' is a real picture the tools cannot read (GIF, WebP, HEIC); undefined is anything else.
export function sniffFormat(head: number[]): ShareFormat | 'unsupported-image' | undefined {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska';
  if (ascii(head, 0, 'GIF8') || (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP'))) return 'unsupported-image';
  if (!ascii(head, 4, 'ftyp')) return undefined;
  return PICTURE_BRANDS.some(b => ascii(head, 8, b)) ? 'unsupported-image' : 'mp4';
}

const extOf = (name: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? '').toLowerCase();

export function claimedKind(mime: string, name: string): ShareKind | undefined {
  const type = mime.split(';')[0].trim().toLowerCase();
  if (IMAGE_MIMES.includes(type)) return 'image';
  if (VIDEO_MIMES.includes(type)) return 'video';
  if (!GENERIC_MIMES.includes(type)) return undefined;
  const ext = extOf(name);
  return IMAGE_EXTS.includes(ext) ? 'image' : VIDEO_EXTS.includes(ext) ? 'video' : undefined;
}

export function cleanName(name: string, fallback: string): string {
  const last = name.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = last
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[\s.]+$/g, '');
  const dot = cleaned.lastIndexOf('.');
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).trim();
  return Array.from(stem).slice(0, 80).join('') || fallback;
}

function refusalText(raw: RawShare, label: string): string {
  if (raw.problem === 'too_big') return `${label} is too big to add (over 2 GB).`;
  if (raw.problem === 'no_space') return `There isn't enough space on your phone to add ${label}.`;
  if (raw.problem) return `${label} couldn't be read. Share it again.`;
  if (sniffFormat(raw.head) === 'unsupported-image') return `${label} isn't a JPEG or PNG picture, so the tools can't use it.`;
  return claimedKind(raw.mime, raw.name)
    ? `${label} looks damaged or isn't really a picture or video.`
    : `${label} isn't a picture or video Design Editor can use.`;
}

export function classifyShare(raws: RawShare[], maxItems = SHARE_MAX_ITEMS): ShareBatch {
  const items: SharedItem[] = [];
  const refused: string[] = [];
  const discard: string[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  for (const raw of raws) {
    const sniffed = raw.problem ? undefined : sniffFormat(raw.head);
    const format = sniffed === 'unsupported-image' ? undefined : sniffed;
    const label = cleanName(raw.name, 'This file');
    if (!format) {
      refused.push(refusalText(raw, label));
      discard.push(raw.uri);
      continue;
    }
    const key = `${raw.bytes}:${raw.head.join(',')}:${label}`;
    if (seen.has(key)) { discard.push(raw.uri); continue; }
    if (items.length >= maxItems) {
      refused.push(`Only the first ${maxItems} were added.`);
      discard.push(raw.uri);
      continue;
    }
    seen.add(key);
    const kind = KIND_OF[format];
    const ext = KEEP_EXTS[format].includes(extOf(raw.name)) ? extOf(raw.name) : DEFAULT_EXT[format];
    const name = outputName(`${cleanName(raw.name, kind === 'image' ? 'Picture' : 'Video')}.x`, '', ext, n => taken.has(n));
    taken.add(name);
    items.push({ uri: raw.uri, name, kind, format, bytes: raw.bytes });
  }
  return { items, refused: [...new Set(refused)], discard };
}
