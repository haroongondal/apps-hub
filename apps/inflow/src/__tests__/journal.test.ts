import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { JournalEntry } from 'inflow-core';
import { JOURNAL_TAGS, MAX_NOTE, appendPage, buildEntry, entrySummary, entryTime, groupByDay, moodLabel, nextCursor, noteCounter, toggleTag } from '../journal.ts';

// TZ is Asia/Karachi (UTC+5, no daylight saving) in the test script.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;
const entry = (id: number, when: number, over: Partial<JournalEntry> = {}): JournalEntry => ({ id, at: when, mood: 3, tags: [], note: '', ...over });

test('the tag list is the ten tags of core/Journal.kt, in its order', () => {
  const kotlin = readFileSync(join(import.meta.dirname, '../../modules/inflow-core/android/src/main/java/expo/modules/inflowcore/core/Journal.kt'), 'utf8');
  const listed = /val TAGS = listOf\(([^)]*)\)/.exec(kotlin)?.[1] ?? '';
  const native = [...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(native.length, 10);
  assert.deepEqual([...JOURNAL_TAGS], native);
});

test('groupByDay groups by local day, newest first, with plain day titles', () => {
  const now = at(2026, 11, 20, 12, 0);
  const entries = [
    entry(5, at(2026, 11, 20, 9, 0)),
    entry(4, at(2026, 11, 20, 0, 5)),
    entry(3, at(2026, 11, 19, 23, 55)),
    entry(2, at(2026, 11, 17, 10, 0)),
  ];
  const groups = groupByDay(entries, now);
  assert.deepEqual(groups.map((g) => [g.day, g.title, g.entries.map((e) => e.id)]), [
    ['2026-11-20', 'Today', [5, 4]],
    ['2026-11-19', 'Yesterday', [3]],
    ['2026-11-17', 'Tue 17 Nov', [2]],
  ]);
  assert.deepEqual(groupByDay([], now), []);
});

test('a day that spans UTC midnight stays one group', () => {
  const now = at(2026, 11, 20, 12, 0);
  // 00:05 and 04:50 Karachi are 19:05 and 23:50 UTC of the day before.
  const groups = groupByDay([entry(2, at(2026, 11, 20, 4, 50)), entry(1, at(2026, 11, 20, 0, 5))], now);
  assert.equal(groups.length, 1);
});

test('paging: a full page has a cursor, a short page ends the list, pages merge without repeats', () => {
  const page = [entry(3, 300), entry(2, 200)];
  assert.equal(nextCursor(page, 2), 200);
  assert.equal(nextCursor(page, 3), null);
  assert.equal(nextCursor([], 2), null);
  assert.deepEqual(appendPage(page, [entry(2, 200), entry(1, 100)]).map((e) => e.id), [3, 2, 1]);
});

test('toggleTag adds, removes and keeps the list order', () => {
  assert.deepEqual(toggleTag([], 'cough'), ['cough']);
  assert.deepEqual(toggleTag(['cough'], 'headache'), ['headache', 'cough']);
  assert.deepEqual(toggleTag(['headache', 'cough'], 'headache'), ['cough']);
});

test('buildEntry checks the mood and note like the native side', () => {
  const when = at(2026, 11, 20, 9, 0);
  assert.deepEqual(buildEntry(null, when, { mood: 4, tags: ['tired'], note: '  slept badly ' }), { id: null, at: when, mood: 4, tags: ['tired'], note: 'slept badly' });
  assert.equal(buildEntry(null, when, { mood: null, tags: [], note: '' }), 'Pick a mood from 1 to 5.');
  assert.equal(buildEntry(null, when, { mood: 6, tags: [], note: '' }), 'Pick a mood from 1 to 5.');
  assert.equal(buildEntry(null, when, { mood: 2, tags: [], note: 'x'.repeat(MAX_NOTE + 1) }), 'Keep the note to 2000 characters or fewer.');
  assert.equal(typeof buildEntry(2, when, { mood: 2, tags: [], note: 'x'.repeat(MAX_NOTE) }), 'object');
  // A character outside the basic plane counts once, like the native code point count.
  assert.equal(typeof buildEntry(null, when, { mood: 2, tags: [], note: '\u{1F600}'.repeat(MAX_NOTE) }), 'object');
});

test('labels and counter are plain', () => {
  assert.equal(moodLabel(1), 'Very low');
  assert.equal(moodLabel(5), 'Very good');
  assert.equal(noteCounter('abc'), '3 of 2000');
  assert.equal(entryTime(at(2026, 11, 20, 7, 5)), '07:05');
  assert.equal(entrySummary(entry(1, 1, { mood: 2, tags: ['cough', 'tired'] })), 'Low, cough, tired');
  assert.equal(entrySummary(entry(1, 1, { mood: 5 })), 'Very good');
});
