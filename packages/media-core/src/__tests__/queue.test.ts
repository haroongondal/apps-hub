import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { nextRunnable, reduce } from '../queue.ts';
import type { Job } from '../types.ts';

const jobs = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/job-examples.json', import.meta.url), 'utf8'),
) as Job[];
const queued = jobs[0];
const other: Job = { ...queued, id: 'job-x', inputName: 'Other.mp4' };

test('queue: the job examples fixture covers every state', () => {
  assert.deepEqual(jobs.map(j => j.state), ['queued', 'running', 'done', 'failed', 'paused', 'interrupted']);
});

test('queue: start, progress, done follow the state machine', () => {
  let q = reduce([], { type: 'enqueue', jobs: [queued] });
  q = reduce(q, { type: 'start', id: queued.id, at: 10 });
  assert.equal(q[0].state, 'running');
  q = reduce(q, { type: 'progress', id: queued.id, fraction: 0.5 });
  assert.equal(q[0].progress, 0.5);
  q = reduce(q, { type: 'done', id: queued.id, outputs: [{ name: 'a.mp4', ref: 'r', bytes: 1 }], at: 20 });
  assert.equal(q[0].state, 'done');
  assert.equal(q[0].finishedAt, 20);
});

test('queue: a retry bumps the attempt and resets progress', () => {
  const q = reduce([{ ...queued, state: 'running', progress: 0.9 }], { type: 'retry', id: queued.id, plan: jobs[1].plan });
  assert.equal(q[0].attempt, 2);
  assert.equal(q[0].progress, 0);
});

test('queue: cancel all stops the running job and every queued one', () => {
  const q = reduce([{ ...queued, state: 'running' }, other, { ...other, id: 'job-y', state: 'done' }],
    { type: 'cancel', id: 'all' });
  assert.deepEqual(q.map(j => j.state), ['cancelled', 'cancelled', 'done']);
});

test('queue: a time-limit pause and a process death both stop the job, and resume re-queues it', () => {
  const paused = reduce([{ ...queued, state: 'running' }], { type: 'pause', reason: 'time-limit' });
  assert.equal(paused[0].state, 'paused');
  const interrupted = reduce([{ ...queued, state: 'running' }], { type: 'interrupt' });
  assert.equal(interrupted[0].state, 'interrupted');
  const resumed = reduce([...paused, { ...queued, id: 'job-2', state: 'interrupted' }], { type: 'resume' });
  assert.deepEqual(resumed.map(j => j.state), ['queued', 'queued']);
});

test('queue: reduce never changes the array it was given', () => {
  const before = [{ ...queued }];
  reduce(before, { type: 'cancel', id: 'all' });
  assert.equal(before[0].state, 'queued');
});

test('queue: one job at a time, in queue order', () => {
  assert.equal(nextRunnable([queued, other])?.id, queued.id);
  assert.equal(nextRunnable([{ ...queued, state: 'running' }, other]), undefined);
  assert.equal(nextRunnable([{ ...queued, state: 'done' }]), undefined);
});
