import type { Kind, SuggestionRow } from '@apps-hub/autopilot-contract';
import type { AutopilotSettings } from 'inflow-core';

const KIND_LABELS: Record<Kind, string> = { reply: 'Reply', bill: 'Bill', event: 'Event', money: 'Check a payment' };
export const kindLabel = (kind: Kind): string => KIND_LABELS[kind] ?? 'Suggestion';

export function waitingSummary(rows: SuggestionRow[]): { count: number; headline: string } {
  const count = rows.filter((r) => r.state === 'waiting').length;
  return { count, headline: count === 0 ? '' : count === 1 ? '1 thing waiting' : `${count} things waiting` };
}

// Waiting: newest created first. History (started, done, skipped, expired): newest expires_at first.
export function groupByState(rows: SuggestionRow[]): { waiting: SuggestionRow[]; history: SuggestionRow[] } {
  const waiting = rows.filter((r) => r.state === 'waiting').sort((a, b) => b.created_at - a.created_at || b.id - a.id);
  const history = rows.filter((r) => r.state !== 'waiting').sort((a, b) => b.expires_at - a.expires_at || b.id - a.id);
  return { waiting, history };
}

// The settings screen edits numbers and package names as text; this is that text.
export interface SettingsForm {
  kinds: Kind[];
  multiple: string;
  minRupees: string;
  hugeRupees: string;
  pickedChats: string[];
  // One package name per line.
  lookIn: string;
  bankApp: string;
  alarmBefore: boolean;
}

export const formFromSettings = (s: AutopilotSettings): SettingsForm => ({
  kinds: s.kinds,
  multiple: String(s.multiple),
  minRupees: String(s.minMinor / 100),
  hugeRupees: String(s.hugeMinor / 100),
  pickedChats: s.pickedChats,
  lookIn: s.lookIn.join('\n'),
  bankApp: s.bankApp ?? '',
  alarmBefore: s.alarmBefore,
});

// Adds or removes the id exactly as the picker gave it.
export const toggleChat = (picked: string[], id: string, on: boolean): string[] =>
  on ? (picked.includes(id) ? picked : [...picked, id]) : picked.filter((p) => p !== id);

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const MULTIPLE_ERROR = 'Enter a whole number from 1 to 1000 for the multiple, for example 3.';
const amountError = (name: string) => `Enter ${name} as a number of rupees, 0 or more, for example 5000.`;

function rupeesToMinor(text: string): number | null {
  const t = text.trim();
  const n = Number(t);
  return t === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100);
}

export type SaveResult = { ok: true; settings: AutopilotSettings } | { ok: false; error: string };

export function settingsForSave(form: SettingsForm): SaveResult {
  const multiple = form.multiple.trim() === '' ? NaN : Number(form.multiple);
  if (!Number.isInteger(multiple) || multiple < 1 || multiple > 1000) return { ok: false, error: MULTIPLE_ERROR };
  const minMinor = rupeesToMinor(form.minRupees);
  if (minMinor === null) return { ok: false, error: amountError('the minimum amount') };
  const hugeMinor = rupeesToMinor(form.hugeRupees);
  if (hugeMinor === null) return { ok: false, error: amountError('the large amount') };
  const lookIn = [...new Set(form.lookIn.split('\n').map((l) => l.trim()).filter((l) => l !== ''))];
  const bad = lookIn.find((p) => !PACKAGE.test(p));
  if (bad !== undefined) return { ok: false, error: `"${bad}" is not a package name. Use names like com.google.android.apps.maps, one per line.` };
  const pickedChats = [...new Set(form.pickedChats.map((c) => c.trim()).filter((c) => c !== ''))];
  const bankApp = form.bankApp.trim();
  return { ok: true, settings: { kinds: form.kinds, multiple, minMinor, hugeMinor, pickedChats, lookIn, bankApp: bankApp === '' ? null : bankApp, alarmBefore: form.alarmBefore } };
}
