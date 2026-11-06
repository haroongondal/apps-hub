import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plainError } from '../media/errors.ts';
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


test('a wrapped native error shows only the sentence a person can read', () => {
  const wrapped = new Error("Call to function 'DesignMedia.open' has been rejected.\n→ Caused by: java.lang.IllegalStateException: No app on this phone can open that file.");
  assert.equal(plainError(wrapped, 'Try again.'), 'No app on this phone can open that file.');
  assert.equal(plainError(new Error("Call to function 'DesignMedia.probe' has been rejected.\n→ Caused by: java.lang.RuntimeException: setDataSource failed: status = 0x80000000"), 'Try again.'), 'Try again.');
  assert.equal(plainError(new Error('That file did not open. Pick a design saved from this editor.'), 'x'), 'That file did not open. Pick a design saved from this editor.');
  assert.equal(plainError(undefined, 'Try again.'), 'Try again.');
});
