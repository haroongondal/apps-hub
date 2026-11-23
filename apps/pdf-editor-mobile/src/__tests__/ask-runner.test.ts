import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SyncReport } from '@apps-hub/knowledge-core';
import type { SourceApp } from '@apps-hub/library-core';

import { createAskRunner, statusLine, type Reports, type SyncPort } from '../nexus/ask-runner.ts';

const report = (r: Partial<SyncReport>): SyncReport => ({ status: 'ready', added: 0, updated: 0, removed: 0, ...r });

function fakeSync(answers: Partial<Record<SourceApp, SyncReport | Error>>, calls: [SourceApp, number][] = [], log: string[] = []) {
  const gate: { release: (() => void) | null; hold: boolean } = { release: null, hold: false };
  const sync: SyncPort = {
    turnOn: async (app) => void log.push(`on:${app}`),
    turnOff: async (app) => (log.push(`off:${app}`), 4),
    async run(app, o) {
      calls.push([app, o.maxNew]);
      if (gate.hold) await new Promise<void>((r) => (gate.release = r));
      const a = answers[app] ?? report({ status: 'disabled' });
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { sync, gate, calls };
}

test('every source is asked in turn with the bound of 50 new items', async () => {
  const { sync, calls } = fakeSync({ inflow: report({ added: 3 }) });
  const runner = createAskRunner({ sync });
  const out = await runner.request();
  assert.deepEqual(calls, [['inflow', 50], ['clipboard', 50], ['deputy', 50]]);
  assert.equal(out.inflow?.added, 3);
  assert.equal(out.deputy?.status, 'disabled');
});

test('a source that cannot be read is a plain line and never stops the others or throws', async () => {
  const { sync } = fakeSync({ inflow: new Error('bridge down'), deputy: report({ status: 'missing' }), clipboard: report({ status: 'failed', error: 'x' }) });
  const runner = createAskRunner({ sync });
  const out = await runner.request();
  assert.equal(out.inflow?.status, 'failed');
  assert.equal(statusLine('inflow', out.inflow), "Couldn't read Inflow right now");
  assert.equal(statusLine('deputy', out.deputy), 'Off in Deputy');
  assert.equal(statusLine('clipboard', out.clipboard), "Couldn't read Clipboard right now");
  assert.equal(statusLine('inflow', report({ status: 'off' })), 'Off in Inflow');
  assert.equal(statusLine('inflow', report({})), null);
  assert.equal(statusLine('inflow', report({ status: 'disabled' })), null);
  assert.equal(statusLine('inflow', undefined), null);
});

test('the runner never deletes anything itself when a source is off or unreachable', async () => {
  const called: string[] = [];
  const sync: SyncPort = {
    run: async () => report({ status: 'off' }),
    turnOn: async () => void called.push('turnOn'),
    turnOff: async () => (called.push('turnOff'), 0),
  };
  await createAskRunner({ sync }).request();
  assert.deepEqual(called, []);
});

test('requests during a run are coalesced into one more run, never overlapping', async () => {
  const { sync, gate, calls } = fakeSync({});
  let active = 0;
  let peak = 0;
  const inner = sync.run;
  sync.run = async (app, o) => {
    peak = Math.max(peak, ++active);
    try {
      return await inner(app, o);
    } finally {
      active--;
    }
  };
  const runner = createAskRunner({ sync });
  gate.hold = true;
  const first = runner.request();
  await new Promise((r) => setTimeout(r, 0));
  const second = runner.request();
  const third = runner.request();
  assert.equal(second, first);
  assert.equal(third, first);
  gate.hold = false;
  gate.release!();
  await first;
  assert.equal(calls.length, 6); // the first run plus exactly one more
  assert.equal(peak, 1);
  const later = await runner.request();
  assert.equal(calls.length, 9);
  assert.ok(later.inflow);
});

test('after each run it is told what changed, and a failure in it does not escape', async () => {
  const seen: Reports[] = [];
  const { sync } = fakeSync({ inflow: report({ added: 2 }) });
  const runner = createAskRunner({
    sync,
    after: async (r) => {
      seen.push(r);
      throw new Error('worker not ready');
    },
  });
  await runner.request();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].inflow?.added, 2);
});

test('turning a source off wipes it through the sync, clears its line and tells listeners', async () => {
  const log: string[] = [];
  const { sync } = fakeSync({ inflow: report({ status: 'missing' }) }, [], log);
  let wiped = 0;
  const runner = createAskRunner({ sync, wiped: () => wiped++ });
  let heard = 0;
  runner.subscribe(() => heard++);
  await runner.request();
  assert.equal(runner.last().inflow?.status, 'missing');
  const before = heard;
  assert.equal(await runner.turnOff('inflow'), 4);
  assert.deepEqual(log, ['off:inflow']);
  assert.equal(runner.last().inflow, undefined);
  assert.equal(heard, before + 1);
  assert.equal(wiped, 1);
});

test('a wipe that fails is thrown, not hidden, and nothing is announced as done', async () => {
  const { sync } = fakeSync({});
  sync.turnOff = async () => {
    throw new Error('disk full');
  };
  let wiped = 0;
  const runner = createAskRunner({ sync, wiped: () => wiped++ });
  await assert.rejects(runner.turnOff('deputy'), /disk full/);
  assert.equal(wiped, 0);
});

test('turning a source on switches it on before the first run', async () => {
  const log: string[] = [];
  const calls: [SourceApp, number][] = [];
  const { sync } = fakeSync({ clipboard: report({ added: 1 }) }, calls, log);
  const inner = sync.run;
  sync.run = async (app, o) => (log.push(`run:${app}`), inner(app, o));
  await createAskRunner({ sync }).turnOn('clipboard');
  assert.deepEqual(log, ['on:clipboard', 'run:inflow', 'run:clipboard', 'run:deputy']);
});
