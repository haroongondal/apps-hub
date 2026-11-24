import type { JournalEntry, JournalInput, JournalTag } from 'inflow-core';
import { dayLabel, lastDays } from './vitals.ts';

// Same ten tags, same order, as core/Journal.kt.
export const JOURNAL_TAGS = ['headache', 'tired', 'stomach ache', 'cough', 'pain', 'anxious', 'low mood', 'poor sleep', 'dizzy', 'nausea'] as const satisfies readonly JournalTag[];

export const MAX_NOTE = 2000;
export const PAGE_SIZE = 30;
export const MOODS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Very low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Very good' },
];

export const DELETE_ENTRY_MESSAGE = "This can't be undone.";
export const LOAD_FAILED = "Inflow couldn't load your journal. Close and reopen the app, then try again.";

const two = (n: number): string => (n < 10 ? `0${n}` : String(n));

export const moodLabel = (mood: number): string => MOODS.find((m) => m.value === mood)?.label ?? '';
export const noteLength = (note: string): number => [...note].length;
export const noteCounter = (note: string): string => `${noteLength(note)} of ${MAX_NOTE}`;

export function entryTime(at: number): string {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function entrySummary(e: JournalEntry): string {
  const parts = [moodLabel(e.mood), ...e.tags];
  return parts.join(', ');
}

export interface DayGroup {
  day: string;
  title: string;
  entries: JournalEntry[];
}

// Entries come newest first; groups keep that order. A day is the local calendar day.
export function groupByDay(entries: JournalEntry[], now: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const e of entries) {
    const day = lastDays(e.at, 1)[0];
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === day) last.entries.push(e);
    else groups.push({ day, title: dayLabel(day, now), entries: [e] });
  }
  return groups;
}

// The cursor for the next page, or null when the last page was short (nothing older).
export function nextCursor(page: JournalEntry[], limit: number): number | null {
  return page.length >= limit ? page[page.length - 1].at : null;
}

export function appendPage(shown: JournalEntry[], page: JournalEntry[]): JournalEntry[] {
  const seen = new Set(shown.map((e) => e.id));
  return [...shown, ...page.filter((e) => !seen.has(e.id))];
}

export interface JournalForm {
  mood: number | null;
  tags: JournalTag[];
  note: string;
}

export function toggleTag(tags: JournalTag[], tag: JournalTag): JournalTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : JOURNAL_TAGS.filter((t) => t === tag || tags.includes(t));
}

// The input to save, or the problem in plain words (same wording as the native checks). A new entry is stamped with `at`.
export function buildEntry(id: number | null, at: number, f: JournalForm): JournalInput | string {
  if (f.mood === null || !Number.isInteger(f.mood) || f.mood < 1 || f.mood > 5) return 'Pick a mood from 1 to 5.';
  const note = f.note.trim();
  if (noteLength(note) > MAX_NOTE) return `Keep the note to ${MAX_NOTE} characters or fewer.`;
  return { id, at, mood: f.mood, tags: f.tags, note };
}
