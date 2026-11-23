import type { DebitRow } from 'nexus-links';

import type { DebitsRead } from '../links/readers.ts';
import type { Match } from './receipt-match.ts';
import { amountText } from './receipt-parse.ts';

export const MAX_DEBIT_PAGES = 10;

// Inflow pages debits oldest first by id, so the newest cannot be asked for alone: read forward until a page comes back empty.
export async function readAllDebits(read: (sinceId: number) => Promise<DebitsRead>, maxPages: number = MAX_DEBIT_PAGES): Promise<DebitsRead> {
  const rows: DebitRow[] = [];
  let since = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await read(since);
    if (r.status !== 'ready') return page === 0 ? { status: r.status, rows: [] } : { status: 'failed', rows: [] };
    if (!r.rows.length) return { status: 'ready', rows };
    const last = Math.max(...r.rows.map((d) => d.id));
    if (last <= since) return { status: 'failed', rows: [] };
    rows.push(...r.rows);
    since = last;
  }
  return { status: 'failed', rows: [] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayText(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const nameOf = (d: DebitRow): string => (d.merchant.trim() ? `${d.merchant.trim()} payment` : 'payment');

export const READ_FAILED = "Couldn't read Inflow right now.";
export const NOT_INSTALLED = "Inflow isn't installed.";
export const SWITCHED_OFF = "Off in Inflow. Turn on 'Let Nexus match my receipts' in Inflow.";
export const NO_MATCH = 'No matching payment found yet.';

export const readLine = (status: DebitsRead['status']): string | null =>
  status === 'ready' ? null : status === 'off' ? SWITCHED_OFF : status === 'missing' ? NOT_INSTALLED : READ_FAILED;

export function matchLine(m: Match): string {
  switch (m.kind) {
    case 'match':
      return `This looks like your ${nameOf(m.debit)} of ${amountText(m.debit.amount_minor)} on ${dayText(m.debit.at)}. Is it the same?`;
    case 'tie':
      return 'More than one payment fits. Pick the one that is yours.';
    case 'weak':
      return "Amount and date match, the name doesn't. Is one of these yours?";
    case 'none':
      return NO_MATCH;
  }
}

export const candidateLine = (d: DebitRow): string => `${dayText(d.at)}, ${amountText(d.amount_minor)}`;
