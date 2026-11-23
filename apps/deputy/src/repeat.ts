export type Preset = 'daily' | 'weekdays' | 'days';

export const DAYS = [
  { n: 1, short: 'Mon', plural: 'Mondays' },
  { n: 2, short: 'Tue', plural: 'Tuesdays' },
  { n: 3, short: 'Wed', plural: 'Wednesdays' },
  { n: 4, short: 'Thu', plural: 'Thursdays' },
  { n: 5, short: 'Fri', plural: 'Fridays' },
  { n: 6, short: 'Sat', plural: 'Saturdays' },
  { n: 7, short: 'Sun', plural: 'Sundays' },
] as const;

const EVERY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];

const same = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);
const sorted = (days: number[]) => [...new Set(days)].sort((x, y) => x - y);

export const presetOf = (days: number[]): Preset => (same(sorted(days), EVERY) ? 'daily' : same(sorted(days), WEEKDAYS) ? 'weekdays' : 'days');

export const daysFor = (preset: Preset, current: number[]): number[] => (preset === 'daily' ? EVERY : preset === 'weekdays' ? WEEKDAYS : sorted(current));

export const toggleDay = (days: number[], n: number): number[] => sorted(days.includes(n) ? days.filter((d) => d !== n) : [...days, n]);

export function describeDays(days: number[]): string {
  const d = sorted(days);
  const preset = presetOf(d);
  if (preset === 'daily') return 'Every day';
  if (preset === 'weekdays') return 'Weekdays';
  if (same(d, [6, 7])) return 'Weekends';
  const names = d.map((n) => DAYS[n - 1]);
  if (names.length === 1) return names[0].plural;
  return `${names.slice(0, -1).map((x) => x.short).join(', ')} and ${names[names.length - 1].short}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const formatTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

/** "8", "8:05", "08.05" and "0805" all read as a time; anything else, or out of range, is null. */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export const describeWhen = (s: { hour: number; minute: number; days: number[] }) => `${describeDays(s.days)} at ${formatTime(s.hour, s.minute)}`;
