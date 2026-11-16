import type { Txn } from 'inflow-core';

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
