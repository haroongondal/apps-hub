import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AiError, type Job } from '@apps-hub/knowledge-core';

import { captureTitle, citationLabel, clockTime, jobLabel, minutesDetail, minutesError, noteTitle, seekTo, sourceText } from '../nexus/labels.ts';

const job = (over: Partial<Job>): Job => ({ itemId: 'x', stage: 'text', status: 'queued', attempts: 0, error: null, updatedAt: 0, ...over });
const none = { ideas: 0, links: 0 };

test('a note is titled by its first non-empty line, without a heading mark', () => {
  assert.equal(noteTitle('\n\n# Event sourcing\nbody'), 'Event sourcing');
  assert.equal(noteTitle('   \n'), 'Untitled note');
  const long = noteTitle('x'.repeat(200));
  assert.equal(Array.from(long).length, 80);
  assert.ok(long.endsWith('…'));
});

test('voice notes and photos are titled by when they were captured', () => {
  const at = new Date(2026, 10, 18, 9, 5);
  assert.equal(captureTitle('audio', at), 'Voice note, 18 Nov 09:05');
  assert.equal(captureTitle('image', at), 'Photo, 18 Nov 09:05');
});

test('the card says what the queue is doing, in plain words', () => {
  assert.deepEqual(jobLabel(null, 'note', true, none), { label: 'Not processed yet', tone: 'neutral' });
  assert.equal(jobLabel(job({}), 'audio', true, none).label, 'Transcribing…');
  assert.equal(jobLabel(job({ stage: 'graph', status: 'running' }), 'note', true, none).label, 'Finding ideas…');
  assert.deepEqual(jobLabel(job({}), 'note', false, none), { label: 'Waiting for an AI key', tone: 'warn' });
  assert.equal(jobLabel(job({ error: 'Offline.' }), 'note', true, none).label, 'Offline.');
  assert.equal(jobLabel(job({ error: 'Offline.', status: 'running' }), 'audio', true, none).label, 'Transcribing…'); // back online, working again
  assert.deepEqual(jobLabel(job({ stage: 'done', status: 'done' }), 'pdf', false, { ideas: 1, links: 6 }), { label: '1 idea, 6 links', tone: 'ok' });
  assert.equal(jobLabel(job({ status: 'failed', error: 'HTTP 400' }), 'note', true, none).tone, 'danger');
  assert.deepEqual(jobLabel(null, 'pdf', true, none, true), { label: 'Not in Nexus', tone: 'neutral' }); // kept out wins over any stale job
});

test('minutes times read m:ss under an hour and h:mm:ss after', () => {
  assert.equal(clockTime(0), '0:00');
  assert.equal(clockTime(65.9), '1:05');
  assert.equal(clockTime(3599), '59:59');
  assert.equal(clockTime(3600), '1:00:00');
  assert.equal(clockTime(3 * 3600 + 7 * 60 + 9), '3:07:09');
  assert.equal(clockTime(-2), '0:00');
});

test('a minutes line says who, when it is due and where it was said, and seeks to its first cite', () => {
  const cites = [
    { segment: 4, startSec: 62 },
    { segment: 9, startSec: 3700 },
  ];
  assert.equal(minutesDetail({ text: 'Send the plan', owner: 'Sam', due: 'by Friday', cites }), 'Sam · by Friday · 1:02, 1:01:40');
  assert.equal(minutesDetail({ text: 'Budget agreed', cites: [cites[0]] }), '1:02');
  assert.equal(seekTo({ text: 'x', cites }), 62);
});

test('a minutes failure says what happened and how to fix it', () => {
  assert.match(minutesError(new AiError('rate', 'The AI service is rate-limiting this key. Nexus tries again later.')), /wait a minute, then try again/i);
  assert.match(minutesError(new AiError('offline', 'queued items continue')), /check your connection, then try again/i);
  assert.equal(minutesError(new AiError('auth', 'No API key is set. Add your key in AI settings.')), 'No API key is set. Add your key in AI settings.');
  assert.equal(minutesError(new Error('This recording is too short to make minutes from.')), 'This recording is too short to make minutes from.');
});

const cite = (o: Partial<Parameters<typeof citationLabel>[0]>) => ({ n: 2, itemId: 'i', title: 'Message from Bank, 3 Nov', kind: 'note' as const, locator: null, text: 't', origin: null, ...o });

test('a citation names a source item by where it came from and any other item by its title', () => {
  assert.equal(citationLabel(cite({ origin: 'From Inflow message, 3 Nov' })), '2 · From Inflow message, 3 Nov');
  assert.equal(citationLabel(cite({ title: 'Trip plan' })), '2 · Trip plan');
  assert.equal(citationLabel(cite({ title: 'Call', locator: { startSec: 62, endSec: 70 } })), '2 · Call, 1:02');
});

test('a source item shows its text without the label line it was saved with', () => {
  assert.equal(sourceText('From Inflow message, 3 Nov, from Bank\n\nYour card ending 1234 was used.'), 'Your card ending 1234 was used.');
  assert.equal(sourceText('Deputy finished it.\n\nFrom the notes'), 'Deputy finished it.\n\nFrom the notes');
});
