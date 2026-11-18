import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Job } from '@apps-hub/knowledge-core';

import { captureTitle, jobLabel, noteTitle } from '../nexus/labels.ts';

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
});
