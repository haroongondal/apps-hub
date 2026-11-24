import type { AiKind } from 'inflow-core';

const KINDS: Record<AiKind, string> = {
  money: 'Money',
  message: 'Message',
  delivery: 'Delivery',
  bill: 'Bill',
  reminder: 'Reminder',
  promotion: 'Promotion',
  account_alert: 'Account alert',
  other: 'Other',
};
export const kindLabel = (kind: AiKind): string => KINDS[kind] ?? 'Other';

const usd = (n: number): string => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
export const capLabel = (capUsd: number | null, spentUsd: number): string =>
  capUsd === null ? `${usd(spentUsd)} today, no limit` : `${usd(spentUsd)} of ${usd(capUsd)} today`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

// Local time: "Today 11:00", "Tomorrow 09:30", "Friday 09:30" within the next 7 days, else "20 Nov 09:30".
export function dueLabel(dueAt: number | null, now: number): string {
  if (dueAt === null) return 'No date';
  const d = new Date(dueAt);
  const n = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days >= 2 && days <= 7) return `${WEEKDAYS[d.getDay()]} ${time}`;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${d.getFullYear() === n.getFullYear() ? day : `${day} ${d.getFullYear()}`} ${time}`;
}

// Empty = no limit; otherwise dollars from 0.01 to 100.
export function parseCap(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/^\$/, '');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return 'invalid';
  const n = Number(t);
  return n >= 0.01 && n <= 100 ? n : 'invalid';
}

export const CAP_ERROR = 'Enter an amount from 0.01 to 100 dollars, or leave it empty for no limit.';
export const CAP_REACHED = "Inflow reached today's AI spending limit. It will send the rest tomorrow, or raise the limit in Settings.";

export const sendResultLabel = (sent: number, saved: number): string =>
  sent === 0 ? 'Nothing was waiting to send.' : `Sent ${sent} ${sent === 1 ? 'item' : 'items'}. ${saved} came back with a summary.`;

export const importanceLabel = (importance: 'high' | 'normal' | 'low'): string => importance.charAt(0).toUpperCase() + importance.slice(1);

export const ASK_EMPTY = "Inflow didn't get an answer. Try again.";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const dayText = (d: Date, now: Date): string => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;

// `to` may be the first instant of the next day (an exclusive end); then the last day shown is the day before.
export function askBasis(items: number, txns: number, from: number, to: number, now: number): string {
  const n = new Date(now);
  const first = new Date(from);
  const exclusive = new Date(to);
  const midnight = exclusive.getHours() === 0 && exclusive.getMinutes() === 0 && exclusive.getSeconds() === 0 && exclusive.getMilliseconds() === 0;
  const last = midnight ? new Date(to - 1) : exclusive;
  const a = dayText(first, n);
  const b = dayText(last, n);
  return `Based on ${plural(items, 'message', 'messages')} and ${plural(txns, 'transaction', 'transactions')} from ${a === b ? a : `${a} to ${b}`}`;
}
