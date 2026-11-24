import type { DoctorInclude, DoctorPreview, DoctorSummary } from 'inflow-core';
import { lastDays } from './vitals.ts';

export const PERIOD_OPTIONS = [
  { key: 7, label: 'Last 7 days' },
  { key: 30, label: 'Last 30 days' },
  { key: 90, label: 'Last 90 days' },
] as const;

export type Period = (typeof PERIOD_OPTIONS)[number]['key'];
export type Section = keyof DoctorInclude;

export const SECTION_OPTIONS: ReadonlyArray<{ key: Section; label: string }> = [
  { key: 'steps', label: 'Steps' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'heartRate', label: 'Heart rate' },
  { key: 'medicines', label: 'Medicines and adherence' },
  { key: 'journal', label: 'Journal' },
];

export const PICK_SOMETHING = 'Pick at least one thing to include.';
export const SEND_FAILED = "Inflow couldn't send that. Close and reopen the app, then try again.";
export const PREVIEW_FAILED = "Inflow couldn't prepare that. Close and reopen the app, then try again.";
export const PDF_FAILED = "Inflow couldn't save the PDF. Try again, or pick another folder.";
export const SENDS_NOTICE = 'Inflow will send exactly this text to Groq (gpt-oss-120b) and nothing else. Nothing is sent until you tap Send.';
export const AI_NOTICE = 'Written by an AI from the text you sent. It can be wrong. Check it before you share it.';
export const HEALTH_IN_ASK_NOTE = 'When on, Ask AI can use your daily steps, sleep and heart rate numbers and how many doses of each medicine you took, for the dates you ask about. It never sees your journal or medicine names. Off by default.';
// The text the module returns when the data moved between the preview and the send.
export const DATA_CHANGED = 'Your data changed since the preview. Review it again.';

export interface Choice {
  fromDay: string;
  toDay: string;
  include: DoctorInclude;
}

// Inclusive local days ending today: 7 days is today and the 6 before it.
export function periodRange(now: number, days: Period): { fromDay: string; toDay: string } {
  const span = lastDays(now, days);
  return { fromDay: span[0], toDay: span[span.length - 1] };
}

// null when nothing is picked.
export function includeFrom(picked: readonly Section[]): DoctorInclude | null {
  if (picked.length === 0) return null;
  const has = (s: Section) => picked.includes(s);
  return { steps: has('steps'), sleep: has('sleep'), heartRate: has('heartRate'), medicines: has('medicines'), journal: has('journal') };
}

export interface Shown extends Choice {
  text: string;
  hash: string;
  chars: number;
}

export type Step =
  | { kind: 'choose' }
  | { kind: 'review'; shown: Shown }
  | { kind: 'sending'; shown: Shown }
  | { kind: 'result'; summary: string; fromDay: string; toDay: string }
  | { kind: 'error'; message: string; again: boolean };

const sameInclude = (a: DoctorInclude, b: DoctorInclude) => a.steps === b.steps && a.sleep === b.sleep && a.heartRate === b.heartRate && a.medicines === b.medicines && a.journal === b.journal;

export const sameChoice = (a: Choice, b: Choice) => a.fromDay === b.fromDay && a.toDay === b.toDay && sameInclude(a.include, b.include);

// The only way to get a hash to send: the one from the preview on screen, and only while the choice still matches it.
export function hashToSend(step: Step, current: Choice): string | null {
  if (step.kind !== 'review') return null;
  return sameChoice(step.shown, current) ? step.shown.hash : null;
}

export function previewStep(choice: Choice, p: DoctorPreview): Step {
  if (p.error !== null) return { kind: 'error', message: p.error, again: false };
  if (p.text === null || p.hash === null) return { kind: 'error', message: PREVIEW_FAILED, again: false };
  return { kind: 'review', shown: { ...choice, text: p.text, hash: p.hash, chars: p.chars } };
}

export function summaryStep(shown: Shown, r: DoctorSummary): Step {
  if (r.error !== null) return { kind: 'error', message: r.error, again: r.error === DATA_CHANGED };
  if (r.summary === null || r.summary.trim() === '') return { kind: 'error', message: SEND_FAILED, again: false };
  return { kind: 'result', summary: r.summary, fromDay: shown.fromDay, toDay: shown.toDay };
}

// The native side names the file; the screen passes only the text and the days.
export function pdfArgs(step: Extract<Step, { kind: 'result' }>): [string, string, string] {
  return [step.summary, step.fromDay, step.toDay];
}

// true -> Saved, false -> the owner cancelled the picker, so nothing is said.
export function pdfMessage(saved: boolean): string | null {
  return saved ? 'Saved' : null;
}

export function charsLabel(chars: number): string {
  return `${String(chars).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${chars === 1 ? 'character' : 'characters'}`;
}
