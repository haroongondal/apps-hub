export interface DueRow {
  title: string;
  dueAt: number;
}

export const TODAY_DAYS = 3;
export const TODAY_MAX_ITEMS = 100;
export const TODAY_MAX_TITLE = 200;
export const TODAY_MAX_BYTES = 64 * 1024; // the provider in nexus-links refuses a larger file
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BREAKS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu;

/** Local midnight `plusDays` calendar days from the day of `ms` (calendar arithmetic, so a 23 or 25 hour day stays right). */
export function startOfDay(ms: number, plusDays = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime();
}

/** The half-open window handed to Library.dueBetween: today and the next days, local time. */
export const todayWindow = (now: number): [number, number] => [startOfDay(now), startOfDay(now, TODAY_DAYS)];

export type QuickPick = 'today' | 'tomorrow' | 'week';
const PICK_DAYS: Record<QuickPick, number> = { today: 0, tomorrow: 1, week: 7 };

/** The end of the picked local day, so the item is still due all day. */
export const dueFor = (pick: QuickPick, now: number): number => startOfDay(now, PICK_DAYS[pick] + 1) - 1;

export function dueText(dueAt: number, now: number): string {
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY_MS);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  const d = new Date(dueAt);
  const date = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return days < 0 ? `Was due ${date}` : `Due ${date}`;
}

/** One line of plain text: no control or line-break characters, at most 200 UTF-16 units, never a split surrogate pair. */
export function cleanTitle(title: string): string {
  const one = title.replace(BREAKS, ' ').trim().slice(0, TODAY_MAX_TITLE);
  const last = one.charCodeAt(one.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? one.slice(0, -1) : one).trim();
}

function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4; // a surrogate pair is one 4-byte character
      i++;
    } else n += 3;
  }
  return n;
}

const stringify = (on: boolean, items: DueRow[]) => JSON.stringify({ v: 1, on, items });

/** The text of files/today.json: {"v":1,"on":bool,"items":[{"title","dueAt"}]}. Titles only, never a body. Switch off serves nothing. */
export function buildTodaySnapshot(rows: readonly DueRow[], switchOn: boolean, now: number): string {
  if (!switchOn) return stringify(false, []);
  const [from, to] = todayWindow(now);
  const items = rows
    .filter((r) => Number.isSafeInteger(r.dueAt) && r.dueAt >= from && r.dueAt < to)
    .map((r) => ({ title: cleanTitle(r.title), dueAt: r.dueAt }))
    .filter((r) => r.title !== '')
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, TODAY_MAX_ITEMS);
  while (items.length && utf8Length(stringify(true, items)) > TODAY_MAX_BYTES) items.pop();
  return stringify(true, items);
}
