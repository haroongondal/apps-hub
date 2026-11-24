import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RunResult } from '@apps-hub/knowledge-core';

import { workerPool } from '../nexus/worker-pool.ts';

function pool(script: RunResult[]) {
  let calls = 0;
  const p = workerPool({
    size: 3,
    runNext: async () => {
      calls++;
      await new Promise((r) => setImmediate(r));
      return script.shift() ?? 'idle';
    },
    active: () => true,
    onTick: () => {},
    onIdle: () => {},
  });
  const finished = async () => {
    while (p.running() > 0) await new Promise((r) => setImmediate(r));
  };
  return { p, script, finished, calls: () => calls };
}

test('the first pause in a kick stops every worker; the calls already in flight finish and nothing more is sent', async () => {
  const s = pool(['paused', 'ran', 'ran', 'ran', 'ran', 'ran', 'ran', 'ran']);
  s.p.start();
  await s.finished();
  assert.equal(s.calls(), 3, 'one call per worker, no more after the pause');
});

test('without a pause the workers keep going until the queue is idle', async () => {
  const s = pool(['ran', 'ran', 'ran', 'ran', 'ran', 'ran']);
  s.p.start();
  await s.finished();
  assert.ok(s.calls() >= 9, `6 jobs ran, then each worker saw idle (${s.calls()} calls)`);
});

test('a later kick, once every worker has stopped, tries again', async () => {
  const s = pool(['paused']);
  s.p.start();
  await s.finished();
  assert.equal(s.calls(), 3);
  s.script.push('ran', 'ran', 'ran', 'ran');
  s.p.start();
  await s.finished();
  assert.ok(s.calls() > 6, `the second kick called the queue again (${s.calls()} calls)`);
});

test('a new kick while a halted loop is still waiting on the hub is not lost, and no more than 3 calls are ever in flight', async () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const waiting: ((r: RunResult) => void)[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  let calls = 0;
  const p = workerPool({
    size: 3,
    runNext: () => {
      calls++;
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      return new Promise<RunResult>((resolve) => waiting.push((r) => (inFlight--, resolve(r))));
    },
    active: () => true,
    onTick: () => {},
    onIdle: () => {},
  });
  p.start();
  await tick();
  assert.equal(calls, 3);
  waiting[0]('paused'); // the kick halts; two long calls are still in flight
  await tick();
  p.start(); // the owner taps Retry: one loop slot is free and the new kick must not inherit the halt
  await tick();
  assert.equal(calls, 4, 'the new kick runs its work although two halted-kick calls are still in flight');
  waiting[1]('ran'); // a loop from the halted kick finishes its call
  await tick();
  assert.equal(calls, 5, 'it moved over to the new kick and asked the queue again instead of stopping');
  for (const w of waiting.slice(2)) w('idle');
  await tick();
  assert.ok(mostInFlight <= 3, `in flight at most 3 (${mostInFlight})`);
  assert.equal(p.running(), 0);
});
