import type { LinkExtras, LinkResult } from 'nexus-links';

type AddTodo = LinkExtras['com.haroon.inflow.action.ADD_TODO'];
type ProposeTask = LinkExtras['com.haroon.deputy.action.PROPOSE_TASK'];

const MAX_TITLE = 200;
const MAX_NOTE = 500;
const MAX_CONTEXT = 2000;
const MAX_LABEL = 100;
const MAX_PART = 60;

// Written by Nexus, never built from item text: what the item says reaches Deputy only as the quoted context.
export const DEPUTY_TASK = 'Do this for me. The details are in the quoted text.';

export const clean = (text: string): string => text.replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim();

// Cuts to `max` UTF-16 units, never inside an emoji, at a word when one falls in the second half; no ellipsis.
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\ud800-\udbff]/.test(text[max - 1]) ? max - 1 : max;
  const head = text.slice(0, end);
  const space = head.lastIndexOf(' ');
  return (text[end] === ' ' || space <= max / 2 ? head : head.slice(0, space)).trimEnd();
}

const part = (text: string | null | undefined, max: number): string => cut(clean(text ?? ''), max);

export interface AddTodoInput {
  text: string;
  minutesLabel?: string;
  owner?: string | null;
  spokenDue?: string | null;
  dueAt?: number | null;
}

export function addTodoExtras(input: AddTodoInput): AddTodo | null {
  const full = clean(input.text);
  if (!full) return null;
  const title = cut(full, MAX_TITLE);
  const owner = part(input.owner, MAX_PART);
  const due = part(input.spokenDue, MAX_PART);
  const head = [part(input.minutesLabel, MAX_LABEL), [owner && `Owner: ${owner}.`, due && `Due: ${due}.`].filter(Boolean).join(' ')].filter(Boolean);
  const room = MAX_NOTE - head.join('\n').length - 1;
  const lines = title === full ? head : [...head, cut(full, room)];
  const extras: AddTodo = { title, source: 'Nexus' };
  if (lines.length) extras.note = lines.join('\n');
  if (typeof input.dueAt === 'number' && Number.isSafeInteger(input.dueAt) && input.dueAt >= 0) extras.dueAt = input.dueAt;
  return extras;
}

export function proposeTaskExtras({ text }: { text: string }): ProposeTask | null {
  const full = clean(text);
  return full ? { task: DEPUTY_TASK, context: cut(full, MAX_CONTEXT) } : null;
}

export type LinkTarget = 'Inflow' | 'Deputy';

export function outcomeText(result: LinkResult, target: LinkTarget): string {
  const inflow = target === 'Inflow';
  switch (result.status) {
    case 'done':
      return inflow ? 'Added to Inflow.' : 'Sent to Deputy. Check it there before it runs.';
    case 'cancelled':
      return inflow ? "You didn't add it." : "You didn't send it.";
    case 'unavailable':
      return `${target} isn't installed.`;
    default:
      if (result.code === 'busy') return 'Wait a moment and tap again.';
      return inflow ? "Inflow didn't accept it." : "Deputy didn't accept it. Nothing was sent.";
  }
}
