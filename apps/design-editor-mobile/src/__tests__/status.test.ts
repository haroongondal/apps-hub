import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jobText } from '../media/status.ts';

const job = (over: Partial<Parameters<typeof jobText>[0]>) => ({ state: 'running' as const, tool: 'size' as const, progress: 0.43, attempt: 1, outputs: [], ...over });

test('a running job says what it is doing; a second try says it in plain words', () => {
  assert.equal(jobText(job({})).line, 'Make smaller · 43%');
  assert.match(jobText(job({ attempt: 2 })).line, /Trying a smaller size/);
});

test('a finished job shows its size in MB; a failure carries its reason; nothing shows a counter or a path', () => {
  const done = jobText(job({ state: 'done', outputs: [{ name: 'a.mp4', ref: 'content://x', bytes: 18_040_000 }] }));
  assert.equal(done.line, 'Make smaller · Saved 18.0 MB');
  assert.match(jobText(job({ state: 'failed', error: "Couldn't fit under 20 MB." })).line, /Couldn't fit under 20 MB/);
  for (const state of ['queued', 'running', 'done', 'failed', 'cancelled', 'paused', 'interrupted'] as const) {
    assert.doesNotMatch(jobText(job({ state })).line, /\btry \d|attempt|content:\/\/|\/Movies/i);
  }
});
