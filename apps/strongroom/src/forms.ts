import type { ExportCounts, ImportBatch, PassFormat, Row } from 'strongroom-vault';
import { COMMON_PASSWORDS } from './common-passwords.ts';

const TOO_SHORT = 'Use at least 12 characters.';
const TOO_COMMON = 'That password is too common. Pick something only you would think of.';
export const MISMATCH = "The two passwords don't match.";

function isRepeatOrRun(codes: number[]): boolean {
  const step = codes[1]! - codes[0]!;
  return Math.abs(step) <= 1 && codes.every((c, i) => i === 0 || c - codes[i - 1]! === step);
}

export function validateMasterPassword(pw: string, confirm: string): string | null {
  const chars = [...pw];
  if (chars.length < 12) return TOO_SHORT;
  if (COMMON_PASSWORDS.has(pw.toLowerCase()) || isRepeatOrRun(chars.map((c) => c.codePointAt(0)!))) return TOO_COMMON;
  return pw === confirm ? null : MISMATCH;
}

// NFC can't unify keyboard variants (Urdu U+06CC vs Arabic U+064A), so the owner is warned, never blocked.
export const keyboardNotice = (pw: string): string | null =>
  /[^\x00-\x7f]/.test(pw) ? "This password uses letters outside A–Z. Type it with the same keyboard on every device, or Strongroom won't recognise it." : null;

const squash = (s: string) => s.replace(/\s/g, '').toUpperCase();

export function recoveryGroupMatches(formatted: string, groupIndex: number, typed: string): boolean {
  const group = formatted.split('-')[groupIndex];
  return group !== undefined && squash(typed) === squash(group);
}

export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q)) : rows;
}

export const pickGroupIndex = (random: () => number): number => Math.floor(random() * 8);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const entries = (n: number) => plural(n, 'entry', 'entries');

export function importRow(b: ImportBatch): { title: string; subtitle: string } {
  const d = new Date(b.at);
  const when = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return b.name ? { title: b.name, subtitle: `${when} · ${entries(b.count)}` } : { title: `Imported ${when}`, subtitle: entries(b.count) };
}

export function importConfirm(b: ImportBatch): string {
  const changed = b.imported === null ? 0 : b.imported - b.count;
  const kept = changed > 0 ? ` ${plural(changed, 'entry', 'entries')} you've edited or deleted since ${changed === 1 ? "isn't" : "aren't"} touched.` : '';
  return `This deletes the ${entries(b.count)} still exactly as imported.${kept} This can't be undone.`;
}

export function exportedNotice(c: ExportCounts): string {
  const parts = [plural(c.logins, 'login', 'logins'), plural(c.cards, 'card', 'cards'), plural(c.notes, 'note', 'notes')];
  return `Exported ${parts[0]}, ${parts[1]} and ${parts[2]}. Delete the file once you're done with it: it isn't encrypted.`;
}

// Mirrors the native barcode encoders, so a bad code is caught on Save and not when the owner needs the pass at a till.
export function validatePass(name: string, code: string, format: PassFormat): string | null {
  if (!name.trim()) return 'Give this pass a name.';
  const c = code.trim();
  if (!c) return 'Enter the code printed under or inside the barcode.';
  if (format === 'ean13' && !/^\d{12,13}$/.test(c)) return 'An EAN-13 code is 12 or 13 digits, with no spaces or letters.';
  if (format === 'code128' && !/^[\x20-\x7e]+$/.test(c)) return 'A Code 128 code can only use letters, digits, spaces and the symbols on a standard keyboard.';
  return null;
}

export const secondsLeft = (until: number, now: number): number => Math.max(0, Math.ceil((until - now) / 1000));
