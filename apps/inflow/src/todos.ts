import type { Todo } from 'inflow-core';

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

export const DUE_HINT = 'Date and time like 2026-11-20 09:30, or just a date. Leave empty for no date.';
export const DUE_ERROR = 'Write the date as year-month-day, like 2026-11-20, with an optional time like 09:30.';
export const TODO_EMPTY = 'Write what needs doing first.';

// Local time. Empty = no date. A date alone means the end of that day, so it stays in "Coming up" all day.
export function parseDue(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t);
  if (m === null) return 'invalid';
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const hour = hasTime ? Number(m[4]) : 23;
  const minute = hasTime ? Number(m[5]) : 59;
  const d = new Date(year, month - 1, day, hour, minute);
  const exact = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && d.getHours() === hour && d.getMinutes() === minute;
  return exact ? d.getTime() : 'invalid';
}

// The inverse of parseDue for the edit field: "2026-11-20 09:30", or empty for no date.
export function dueInput(dueAt: number | null): string {
  if (dueAt === null) return '';
  const d = new Date(dueAt);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// Open ones first (dated soonest first, then undated), done ones after, as listTodos returns them; this keeps a list stable after a local edit.
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if ((a.dueAt === null) !== (b.dueAt === null)) return a.dueAt === null ? 1 : -1;
    if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    return a.id - b.id;
  });
}
