import type { Row } from 'strongroom-vault';
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
