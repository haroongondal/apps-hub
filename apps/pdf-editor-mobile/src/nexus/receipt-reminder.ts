import type { LinkExtras } from 'nexus-links';

import { addTodoExtras, clean, cut } from './action-links.ts';
import { addDays, middayOf, type Receipt } from './receipt-parse.ts';

export const REMIND_DAYS_BEFORE = 14;
const MAX_TITLE = 200;
const MAX_NOTE = 500;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface WarrantyReminder {
  title: string;
  dueAt: number;
  note: string;
  extras: LinkExtras['com.haroon.inflow.action.ADD_TODO'];
}

const readable = (day: string): string => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

/** A to-do for Inflow two weeks before the warranty ends, at local midday; null when there is no warranty date or that moment has passed. */
export function warrantyReminder(receipt: Receipt, now: number = Date.now()): WarrantyReminder | null {
  if (!receipt.warrantyEnd) return null;
  const dueAt = middayOf(addDays(receipt.warrantyEnd, -REMIND_DAYS_BEFORE));
  if (dueAt <= now) return null;
  const merchant = clean(receipt.merchant);
  const title = cut(`Warranty ends: ${merchant}`, MAX_TITLE);
  const note = cut(`Warranty for ${merchant} ends on ${readable(receipt.warrantyEnd)}. Receipt scanned in Nexus.`, MAX_NOTE);
  const base = addTodoExtras({ text: title, dueAt });
  if (!base) return null;
  return { title, dueAt, note, extras: { ...base, note } };
}
