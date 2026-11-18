import type { MoneySummary, Txn } from 'inflow-core';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Digit strings, not division: the decimals stay exact for any safe integer.
export function formatAmount(minor: number, currency: string): string {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${minor < 0 ? '-' : ''}${currency} ${whole}.${digits.slice(-2)}`;
}

// Local time. `to` is the first instant of the next month, so ranges are [from, to).
export function monthRange(year: number, month: number): { from: number; to: number } {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

export const monthLabel = (year: number, month: number): string => `${MONTHS[month]} ${year}`;

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// listTxns pages newest first with no upper or lower bound, so a month view trims each page to [from, to) and stops at the first row before `from`.
export function withinMonth(page: Txn[], from: number, to: number): { rows: Txn[]; done: boolean } {
  const rows = page.filter((t) => t.at >= from && t.at < to);
  return { rows, done: page.some((t) => t.at < from) };
}

export const signedAmount = (t: Pick<Txn, 'direction' | 'amount' | 'currency'>): string => `${t.direction === 'in' ? '+' : '-'}${formatAmount(t.amount, t.currency)}`;

export const partyTitle = (p: { name: string | null; own: boolean }): string => (p.own ? 'Between your accounts' : (p.name ?? 'Unknown'));

export function partySubtitle(p: { currency: string; moneyIn: number; moneyOut: number; count: number }): string {
  const sides = [p.moneyIn > 0 ? `in ${formatAmount(p.moneyIn, p.currency)}` : null, p.moneyOut > 0 ? `out ${formatAmount(p.moneyOut, p.currency)}` : null].filter((s) => s !== null);
  const text = [...sides, `${p.count} ${p.count === 1 ? 'transaction' : 'transactions'}`].join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface MonthOverview {
  currency: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  count: number;
  categories: { category: string; total: number; count: number; share: number }[];
}

// One entry per currency, biggest first. Category share is a percent of that currency's money out.
export function monthOverview(s: MoneySummary): MonthOverview[] {
  const byCurrency = new Map<string, MonthOverview>();
  for (const a of s.accounts) {
    const o = byCurrency.get(a.currency) ?? { currency: a.currency, moneyIn: 0, moneyOut: 0, net: 0, count: 0, categories: [] };
    o.moneyIn += a.moneyIn;
    o.moneyOut += a.moneyOut;
    o.count += a.count;
    byCurrency.set(a.currency, o);
  }
  for (const o of byCurrency.values()) {
    o.net = o.moneyIn - o.moneyOut;
    o.categories = s.categories
      .filter((c) => c.currency === o.currency)
      .map((c) => ({ category: c.category, total: c.total, count: c.count, share: o.moneyOut > 0 ? (c.total / o.moneyOut) * 100 : 0 }));
  }
  return [...byCurrency.values()].sort((x, y) => y.moneyIn + y.moneyOut - (x.moneyIn + x.moneyOut));
}
