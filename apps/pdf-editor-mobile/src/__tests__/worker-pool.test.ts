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
