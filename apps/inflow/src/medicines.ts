import type { AdherenceReport, AdherenceRow, DoseRow, Medicine, MedicineInput } from 'inflow-core';
import type { Tone } from '@apps-hub/ui';
import { lastDays } from './vitals.ts';

export const MEDICAL_LINE = 'Inflow is not a medical device.';
export const REMINDERS_OFF = "Reminders can't show until Inflow can send notifications.";
export const DELETE_MEDICINE_MESSAGE = "This also deletes its history. This can't be undone.";
export const STOP_MEDICINE_MESSAGE = 'Inflow stops reminding you. Its history stays.';
export const LOAD_FAILED = "Inflow couldn't load your medicines. Close and reopen the app, then try again.";

// Same limits as the native side, so the sheet can say what is wrong before saving.
export const MAX_TEXT = 80;
export const MAX_TIMES = 12;
export const EARLY_MS = 60 * 60 * 1000;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_CHIPS: ReadonlyArray<{ day: number; label: string; full: string }> = [
  { day: 1, label: 'Mon', full: 'Monday' },
  { day: 2, label: 'Tue', full: 'Tuesday' },
  { day: 3, label: 'Wed', full: 'Wednesday' },
  { day: 4, label: 'Thu', full: 'Thursday' },
  { day: 5, label: 'Fri', full: 'Friday' },
  { day: 6, label: 'Sat', full: 'Saturday' },
  { day: 7, label: 'Sun', full: 'Sunday' },
];

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function daysSummary(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  return sorted.map((d) => DAY_NAMES[d - 1]).join(', ');
}

export function timesSummary(times: string[]): string {
  return [...times].sort().join(', ');
}

export function medicineSubtitle(m: Medicine): string {
  return `${m.dose}. ${timesSummary(m.times)}. ${daysSummary(m.days)}.`;
}

export function splitMedicines(all: Medicine[]): { active: Medicine[]; stopped: Medicine[] } {
  return { active: all.filter((m) => m.active), stopped: all.filter((m) => !m.active) };
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export type DoseAction = 'taken' | 'skipped';

export interface DoseView {
  label: string;
  tone: Tone;
  actions: DoseAction[];
}

// Buttons follow the native rule: a dose can be marked from an hour before it is due, and a skipped or missed one can still be corrected to taken.
export function doseView(d: DoseRow, now: number): DoseView {
  if (d.status === 'taken') return { label: 'Taken', tone: 'ok', actions: [] };
  if (d.status === 'skipped') return { label: 'Skipped', tone: 'neutral', actions: ['taken'] };
  if (d.status === 'missed') return { label: 'Missed', tone: 'warn', actions: ['taken'] };
  if (d.status === 'pending') return { label: 'Due now', tone: 'accent', actions: ['taken', 'skipped'] };
  const soon = d.dueAt - now <= EARLY_MS;
  return { label: 'Coming up', tone: 'neutral', actions: soon ? ['taken', 'skipped'] : [] };
}

export const todayKey = (now: number): string => lastDays(now, 1)[0];

export function adherenceCounts(r: AdherenceRow): string {
  return `Taken ${r.taken} of ${r.taken + r.skipped + r.missed}`;
}

export function percentText(r: AdherenceRow): string {
  return r.percent === null ? 'Nothing counted yet' : `${r.percent}%`;
}

export function streakText(days: number): string {
  if (days <= 0) return 'No days in a row yet';
  return days === 1 ? '1 day in a row' : `${days} days in a row`;
}

export interface AdherenceLine {
  key: string;
  name: string;
  percent: string;
  counts: string;
  streak: string;
}

export function adherenceLines(report: AdherenceReport, medicines: Medicine[]): AdherenceLine[] {
  const line = (r: AdherenceRow, name: string): AdherenceLine => ({ key: String(r.medicineId), name, percent: percentText(r), counts: adherenceCounts(r), streak: streakText(r.streak) });
  const names = new Map(medicines.map((m) => [m.id, m.name]));
  const each = report.medicines.map((r) => line(r, names.get(r.medicineId as number) ?? 'A removed medicine'));
  return each.length > 1 ? [line(report.all, 'All medicines'), ...each] : each;
}

export interface MedicineForm {
  name: string;
  dose: string;
  times: string[];
  days: number[];
  startDay: string;
  endDay: string;
}

export function emptyForm(now: number): MedicineForm {
  return { name: '', dose: '', times: ['08:00'], days: [1, 2, 3, 4, 5, 6, 7], startDay: todayKey(now), endDay: '' };
}

export function formFromMedicine(m: Medicine): MedicineForm {
  return { name: m.name, dose: m.dose, times: [...m.times], days: [...m.days], startDay: m.startDay, endDay: m.endDay ?? '' };
}

// "8:30" becomes "08:30"; null when it is not an hour and minute.
export function normalizeTime(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? `${two(hour)}:${two(minute)}` : null;
}

export function validDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m === null) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === text;
}

// The saved input, or the problem in plain words (same wording as the native checks).
export function buildMedicine(id: number | null, f: MedicineForm): MedicineInput | string {
  const name = f.name.trim();
  const dose = f.dose.trim();
  const times = f.times.map(normalizeTime);
  const start = f.startDay.trim();
  const end = f.endDay.trim();
  if (name === '') return "Write the medicine's name.";
  if ([...name].length > MAX_TEXT) return `Keep the name to ${MAX_TEXT} characters or fewer.`;
  if (dose === '') return 'Write the dose, for example 1 tablet.';
  if ([...dose].length > MAX_TEXT) return `Keep the dose to ${MAX_TEXT} characters or fewer.`;
  if (times.length === 0) return 'Add at least one time of day.';
  if (times.includes(null)) return 'Write times as hours and minutes, like 08:30.';
  if (times.length > MAX_TIMES) return `Add at most ${MAX_TIMES} times a day.`;
  if (new Set(times).size !== times.length) return 'Each time can be added once.';
  if (f.days.length === 0) return 'Pick at least one day of the week.';
  if (!validDay(start)) return 'Write the start date as year-month-day, like 2026-11-20.';
  if (end !== '' && !validDay(end)) return 'Write the end date as year-month-day, or leave it empty.';
  if (end !== '' && end < start) return "The end date can't be before the start date.";
  return { id, name, dose, times: (times as string[]).sort(), days: [...new Set(f.days)].sort((a, b) => a - b), startDay: start, endDay: end === '' ? null : end };
}
