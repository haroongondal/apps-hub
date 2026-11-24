import type { DebitRow } from 'nexus-links';

import { middayOf, type Receipt } from './receipt-parse.ts';

export type Match =
  | { kind: 'match'; debit: DebitRow }
  | { kind: 'tie'; candidates: DebitRow[] }
  | { kind: 'weak'; candidates: DebitRow[] }
  | { kind: 'none' };

export const WINDOW_DAYS = 3;
export const MAX_CANDIDATES = 3;
const MIN_SCORE = 0.5;
const DAY_MS = 86_400_000;
const LEGAL = new Set(['ltd', 'limited', 'llc', 'pvt', 'private', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'llp', 'plc', 'gmbh', 'sa', 'srl', 'the']);
const ARABIC = /\p{Script=Arabic}/u;

const normalise = (name: string): string[] =>
  name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t && !LEGAL.has(t));

const bigrams = (s: string): string[] => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));

function dice(a: string, b: string): number {
  const [x, y] = [bigrams(a), bigrams(b)];
  if (!x.length || !y.length) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let shared = 0;
  for (const g of x) {
    const left = pool.get(g) ?? 0;
    if (left > 0) {
      shared++;
      pool.set(g, left - 1);
    }
  }
  return (2 * shared) / (x.length + y.length);
}

function jaccard(a: string[], b: string[]): number {
  const [x, y] = [new Set(a), new Set(b)];
  const both = [...x].filter((t) => y.has(t)).length;
  return both / (x.size + y.size - both || 1);
}

/** 0 to 1: how alike two business names are. Arabic and Urdu script names count only when one holds the other. */
export function merchantScore(a: string, b: string): number {
  const [ta, tb] = [normalise(a), normalise(b)];
  const [sa, sb] = [ta.join(' '), tb.join(' ')];
  if (!sa || !sb) return 0;
  const arabic = ARABIC.test(sa) || ARABIC.test(sb);
  const shorter = Math.min(sa.length, sb.length);
  const holds = shorter >= (arabic ? 2 : 3) && (sa.includes(sb) || sb.includes(sa));
  if (holds) return 1;
  if (arabic) return 0;
  return Math.max(dice(ta.join(''), tb.join('')), jaccard(ta, tb));
}

// Whole local calendar days, so a 23 or 25 hour day counts as one.
const dayNumber = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
};

export const dayGap = (debitAt: number, receiptDate: string): number => Math.abs(dayNumber(debitAt) - dayNumber(middayOf(receiptDate)));

interface Ranked {
  debit: DebitRow;
  score: number;
  gap: number;
}

const byBest = (a: Ranked, b: Ranked) => b.score - a.score || a.gap - b.gap || a.debit.id - b.debit.id;
const same = (a: Ranked, b: Ranked) => Math.abs(a.score - b.score) < 1e-9 && a.gap === b.gap;

/**
 * The debit that is probably this receipt. A name that fits and the same amount within three days is a match; two equally good ones are a tie;
 * a right amount and day with a different name is only ever 'weak'. The caller must still ask the owner before anything is kept.
 */
export function matchReceipt(receipt: Receipt, debits: readonly DebitRow[]): Match {
  const close: Ranked[] = debits
    .filter((d) => d.amount_minor === receipt.amountMinor)
    .map((debit) => ({ debit, score: merchantScore(debit.merchant, receipt.merchant), gap: dayGap(debit.at, receipt.date) }))
    .filter((r) => r.gap <= WINDOW_DAYS)
    .sort(byBest);
  const named = close.filter((r) => r.score >= MIN_SCORE);
  if (named.length === 1 || (named.length > 1 && !same(named[0], named[1]))) return { kind: 'match', debit: named[0].debit };
  const pick = (list: Ranked[]) => list.slice(0, MAX_CANDIDATES).map((r) => r.debit);
  if (named.length > 1) return { kind: 'tie', candidates: pick(named) };
  return close.length ? { kind: 'weak', candidates: pick(close) } : { kind: 'none' };
}
