import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DATA_CHANGED, PREVIEW_FAILED, SEND_FAILED, charsLabel, hashToSend, includeFrom, pdfArgs, pdfMessage, periodRange, previewStep, summaryStep, type Choice, type Shown } from '../doctor.ts';

// TZ is Asia/Karachi (UTC+5, no daylight saving) in the test script.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;

const choice = (over: Partial<Choice> = {}): Choice => ({ fromDay: '2026-11-18', toDay: '2026-11-24', include: { steps: true, sleep: false, heartRate: false, medicines: false, journal: false }, ...over });
const shown = (over: Partial<Shown> = {}): Shown => ({ ...choice(), text: 'Steps...', hash: 'h1', chars: 8, ...over });

test('a period is that many local days ending today, inclusive', () => {
  assert.deepEqual(periodRange(at(2026, 11, 24, 10, 0), 7), { fromDay: '2026-11-18', toDay: '2026-11-24' });
  assert.deepEqual(periodRange(at(2026, 11, 24, 10, 0), 30), { fromDay: '2026-10-26', toDay: '2026-11-24' });
  assert.deepEqual(periodRange(at(2026, 11, 24, 10, 0), 90), { fromDay: '2026-08-27', toDay: '2026-11-24' });
});

test('a period crosses a month boundary and uses the local day, not the UTC day', () => {
  assert.deepEqual(periodRange(at(2026, 12, 3, 1, 0), 7), { fromDay: '2026-11-27', toDay: '2026-12-03' });
  assert.deepEqual(periodRange(at(2026, 3, 2, 0, 30), 7), { fromDay: '2026-02-24', toDay: '2026-03-02' });
});

test('include needs at least one section', () => {
  assert.equal(includeFrom([]), null);
  assert.deepEqual(includeFrom(['sleep', 'journal']), { steps: false, sleep: true, heartRate: false, medicines: false, journal: true });
});

test('a preview becomes a review, and an error or a missing hash never does', () => {
  const c = choice();
  assert.deepEqual(previewStep(c, { text: 'abc', hash: 'h', chars: 3, error: null }), { kind: 'review', shown: { ...c, text: 'abc', hash: 'h', chars: 3 } });
  assert.deepEqual(previewStep(c, { text: null, hash: null, chars: 0, error: 'Pick at most 90 days.' }), { kind: 'error', message: 'Pick at most 90 days.', again: false });
  assert.deepEqual(previewStep(c, { text: 'abc', hash: null, chars: 3, error: null }), { kind: 'error', message: PREVIEW_FAILED, again: false });
});

test('the stale guard sends only the hash of the preview on screen for the current choice', () => {
  const s = shown();
  assert.equal(hashToSend({ kind: 'review', shown: s }, choice()), 'h1');
  assert.equal(hashToSend({ kind: 'review', shown: s }, choice({ fromDay: '2026-11-17' })), null);
  assert.equal(hashToSend({ kind: 'review', shown: s }, choice({ toDay: '2026-11-23' })), null);
  assert.equal(hashToSend({ kind: 'review', shown: s }, choice({ include: { ...choice().include, journal: true } })), null);
  assert.equal(hashToSend({ kind: 'choose' }, choice()), null);
  assert.equal(hashToSend({ kind: 'sending', shown: s }, choice()), null);
  assert.equal(hashToSend({ kind: 'error', message: 'x', again: false }, choice()), null);
});

test('a new preview replaces the old hash', () => {
  const fresh = previewStep(choice({ fromDay: '2026-11-01' }), { text: 'new', hash: 'h2', chars: 3, error: null });
  assert.equal(hashToSend(fresh, choice({ fromDay: '2026-11-01' })), 'h2');
  assert.equal(hashToSend(fresh, choice()), null);
});

test('each native result shape picks one state', () => {
  const s = shown();
  assert.deepEqual(summaryStep(s, { summary: 'All good', error: null }), { kind: 'result', summary: 'All good', fromDay: s.fromDay, toDay: s.toDay });
  assert.deepEqual(summaryStep(s, { summary: null, error: DATA_CHANGED }), { kind: 'error', message: DATA_CHANGED, again: true });
  assert.deepEqual(summaryStep(s, { summary: null, error: 'Something went wrong. Nothing was sent.' }), { kind: 'error', message: 'Something went wrong. Nothing was sent.', again: false });
  assert.deepEqual(summaryStep(s, { summary: null, error: null }), { kind: 'error', message: SEND_FAILED, again: false });
  assert.deepEqual(summaryStep(s, { summary: '  \n', error: null }), { kind: 'error', message: SEND_FAILED, again: false });
});

test('the summary is kept as plain text, untouched', () => {
  const text = '**bold** [link](https://example.com) <b>x</b>';
  const step = summaryStep(shown(), { summary: text, error: null });
  assert.equal(step.kind === 'result' ? step.summary : null, text);
});

test('the PDF call carries the text and the days, never a file name', () => {
  const step = summaryStep(shown(), { summary: 'S', error: null });
  assert.equal(step.kind, 'result');
  if (step.kind !== 'result') return;
  assert.deepEqual(pdfArgs(step), ['S', '2026-11-18', '2026-11-24']);
  assert.equal(pdfMessage(true), 'Saved');
  assert.equal(pdfMessage(false), null);
});

test('the character count has thousands separators', () => {
  assert.equal(charsLabel(1), '1 character');
  assert.equal(charsLabel(12345), '12,345 characters');
});
