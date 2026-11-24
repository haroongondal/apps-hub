import type { HealthDay, HealthStatus } from 'inflow-core';

export type VitalsState = 'missing' | 'update' | 'not-allowed' | 'empty' | 'data';

export interface VitalsCopy {
  title: string;
  body: string;
  action: 'allow' | null;
}

export type Metric = 'steps' | 'sleepMinutes' | 'hrAvg';

export const SHOWN_DAYS = 7;
export const REFRESH_DAYS = 30;
export const REFRESH_GAP_MS = 15 * 60 * 1000;

export const NOT_A_MEDICAL_DEVICE = 'Inflow is not a medical device. Numbers are only what your phone or watch recorded.';
export const REFRESH_FAILED = "Inflow couldn't read Health Connect. Close and reopen the app, then try again.";
export const ACCESS_NOT_GIVEN = 'Access was not given. You can change this in Health Connect, under App permissions, Inflow.';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));
const dayKey = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const hasData = (d: HealthDay): boolean => d.steps !== null || d.sleepMinutes !== null || d.hrAvg !== null;

export function vitalsState(status: HealthStatus, series: HealthDay[]): VitalsState {
  if (status.availability === 'missing') return 'missing';
  if (status.availability === 'update') return 'update';
  if (!status.steps && !status.sleep && !status.heartRate) return 'not-allowed';
  return series.some(hasData) ? 'data' : 'empty';
}

// Some metrics allowed, others not: names the missing ones so the screen can offer "Allow access" again.
export function partialAccessNote(status: HealthStatus): string | null {
  const missing = [!status.steps && 'steps', !status.sleep && 'sleep', !status.heartRate && 'heart rate'].filter((m): m is string => m !== false);
  if (missing.length === 0 || missing.length === 3) return null;
  return `Inflow can't read your ${missing.join(' and ')} yet. Allow access to add ${missing.length === 1 ? 'it' : 'them'}.`;
}

export function vitalsCopy(state: Exclude<VitalsState, 'data'>): VitalsCopy {
  if (state === 'missing') {
    return {
      title: "Health Connect isn't on this phone",
      body: "Inflow reads your steps, sleep and heart rate through Health Connect. On Android 13 and older, install the Health Connect app from the place you usually get apps, then come back here. On Android 14 and newer it is part of the phone: search Settings for Health Connect.",
      action: null,
    };
  }
  if (state === 'update') {
    return {
      title: 'Health Connect needs an update',
      body: 'Update Health Connect from the place you usually get apps, or in your phone\'s system update on Android 14 and newer. Then come back here.',
      action: null,
    };
  }
  if (state === 'not-allowed') {
    return {
      title: "Inflow can't read your health numbers yet",
      body: 'Inflow reads only your steps, sleep and heart rate, and shows them here. They leave this phone only in a Doctor summary you read and send, or as daily numbers for Ask AI if you turn that on in Settings.',
      action: 'allow',
    };
  }
  return {
    title: 'No steps, sleep or heart rate saved in Health Connect for these days yet',
    body: 'Wear your watch, or open the app that records them, and let it sync to Health Connect. Then tap Refresh.',
    action: null,
  };
}

// Local calendar days ending today, oldest first. Built from year, month and day so a clock change never skips or repeats a day.
export function lastDays(now: number, count: number): string[] {
  const t = new Date(now);
  return Array.from({ length: count }, (_, i) => dayKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - (count - 1 - i))));
}

export function fillSeries(days: string[], rows: HealthDay[]): HealthDay[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return days.map((day) => byDay.get(day) ?? { day, steps: null, sleepMinutes: null, hrAvg: null, hrLow: null });
}

// Mean over the days that have a value, rounded; null when no day has one.
export function average(series: HealthDay[], metric: Metric): number | null {
  const values = series.map((d) => d[metric]).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function formatSteps(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatSleep(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export const formatBpm = (bpm: number): string => `${Math.round(bpm)} bpm`;

export function formatMetric(metric: Metric, value: number): string {
  if (metric === 'steps') return formatSteps(value);
  return metric === 'sleepMinutes' ? formatSleep(value) : formatBpm(value);
}

export function dayLabel(day: string, now: number): string {
  const days = lastDays(now, 2);
  if (day === days[1]) return 'Today';
  if (day === days[0]) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]}`;
}

// Bar length 0..1 against the biggest value in the list; days without a value get 0.
export function barFraction(value: number | null, series: HealthDay[], metric: Metric): number {
  if (value === null) return 0;
  const max = Math.max(...series.map((d) => d[metric] ?? 0));
  return max > 0 ? value / max : 0;
}

// Opening the section and returning to the app refresh at most once per 15 minutes (Health Connect rate limits); the Refresh button always runs.
export function shouldRefresh(lastRunAt: number | null, now: number, manual: boolean): boolean {
  if (manual || lastRunAt === null) return true;
  return now - lastRunAt >= REFRESH_GAP_MS || now < lastRunAt;
}

// One line under the "Steps, sleep and heart rate" row on the Health screen.
export function summaryLine(state: VitalsState, today: HealthDay | undefined): string {
  if (state === 'data') return today?.steps != null ? `Today: ${formatSteps(today.steps)} steps` : 'See the last 7 days';
  if (state === 'empty') return 'Nothing saved for these days yet';
  if (state === 'not-allowed') return 'Allow access to see them';
  return "Health Connect isn't ready";
}
