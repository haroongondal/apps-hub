import test from 'node:test';
import assert from 'node:assert/strict';

import { HOME_PROBE_PORTS } from '../people.ts';
import { wakeAndWatch, WAKE_PORT } from '../wake.ts';

// probeHome tries every port of a round until one answers, so rounds = ceil(probes / ports).
const P = HOME_PROBE_PORTS.length;
const rounds = (probes: number) => Math.ceil(probes / P);

const MAC = 'aa:bb:cc:dd:ee:ff';
const IFACE = { localIp: '192.168.1.20', cidrPrefix: 24 };

// A fake clock: sleep advances it, so a 60 s watch runs instantly.
function rig(opts: { awakeAfterRound?: number; sendFails?: boolean; abortAfterSends?: number; abortOnSleep?: number; abortAfterRound?: number } = {}) {
  const ctrl = new AbortController();
  const log = { sends: [] as { ip: string; port: number; payload: readonly number[] }[], probes: 0, sleeps: [] as number[], clock: 0 };
  const binding = {
    async sendUdpBroadcast(ip: string, port: number, payload: readonly number[]) {
      log.sends.push({ ip, port, payload });
      if (opts.sendFails) throw new Error('no route');
    },
    async measureTcpHandshake() {
      log.probes += 1;
      if (rounds(log.probes) === opts.abortAfterRound) ctrl.abort();
      return { outcome: rounds(log.probes) >= (opts.awakeAfterRound ?? Infinity) ? ('refused' as const) : ('timeout' as const), rttMs: null };
    },
  };
  const run = (over: Partial<Parameters<typeof wakeAndWatch>[0]> = {}) =>
    wakeAndWatch({
      binding,
      mac: MAC,
      iface: IFACE,
      targetIp: '192.168.1.50',
      signal: ctrl.signal,
      now: () => log.clock,
      sleep: async (ms) => {
        log.sleeps.push(ms);
        log.clock += ms;
        if (log.sends.length === opts.abortAfterSends || log.sleeps.length === opts.abortOnSleep) ctrl.abort();
      },
      ...over,
    });
  return { log, run, ctrl };
}

test('sends exactly 3 magic packets, 300 ms apart, to the subnet broadcast on port 9', async () => {
  const { log, run } = rig({ awakeAfterRound: 1 });
  assert.equal(await run(), 'awake');
  assert.equal(log.sends.length, 3);
  for (const s of log.sends) {
    assert.equal(s.ip, '192.168.1.255');
    assert.equal(s.port, WAKE_PORT);
    assert.equal(s.payload.length, 102);
  }
  assert.deepEqual(log.sleeps.slice(0, 2), [300, 300]);
});

test('stops probing as soon as the device answers', async () => {
  const { log, run } = rig({ awakeAfterRound: 3 });
  assert.equal(await run(), 'awake');
  assert.equal(log.probes, 2 * P + 1); // the first port of round 3 answered; the other ports are not tried
  assert.equal(log.sends.length, 3);
});

test('times out after 60 s with at most 20 probes, 3 s apart', async () => {
  const { log, run } = rig();
  assert.equal(await run(), 'no-answer');
  assert.equal(rounds(log.probes), 20);
  assert.equal(log.probes, 20 * P);
  assert.ok(log.sleeps.slice(2).every((ms) => ms === 3000));
});

test('abort during the sends stops further sends and probes', async () => {
  const { log, run } = rig({ abortAfterSends: 1 });
  assert.equal(await run(), 'cancelled');
  assert.equal(log.sends.length, 1);
  assert.equal(log.probes, 0);
});

test('abort during the watch stops further probes', async () => {
  const { log, run } = rig({ abortAfterRound: 2 });
  assert.equal(await run(), 'cancelled');
  assert.equal(rounds(log.probes), 2);
  assert.equal(log.probes, 2 * P);
});

test('abort while waiting between probes sends no further probe', async () => {
  const { log, run } = rig({ abortOnSleep: 5 }); // 2 gaps between sends, then the 3rd probe wait
  assert.equal(await run(), 'cancelled');
  assert.equal(rounds(log.probes), 2);
});

test('abort during the probe that would have answered is "cancelled", not "awake"', async () => {
  const { run } = rig({ awakeAfterRound: 2, abortAfterRound: 2 });
  assert.equal(await run(), 'cancelled');
});

test('an already-aborted signal sends nothing', async () => {
  const { log, run, ctrl } = rig();
  ctrl.abort();
  assert.equal(await run(), 'cancelled');
  assert.equal(log.sends.length, 0);
  assert.equal(log.probes, 0);
});

test('a failed first send is "failed" and nothing is probed', async () => {
  const { log, run } = rig({ sendFails: true });
  assert.equal(await run(), 'failed');
  assert.equal(log.sends.length, 1);
  assert.equal(log.probes, 0);
});

test('a failed repeat send after a first success is ignored', async () => {
  const { log, run } = rig({ awakeAfterRound: 1 });
  const original = log.sends;
  let calls = 0;
  const result = await run({
    binding: {
      async sendUdpBroadcast(ip: string, port: number, payload: readonly number[]) {
        calls += 1;
        original.push({ ip, port, payload });
        if (calls > 1) throw new Error('flaky');
      },
      async measureTcpHandshake() {
        return { outcome: 'open' as const, rttMs: 1 };
      },
    },
  });
  assert.equal(result, 'awake');
  assert.equal(calls, 3);
});

test('no Wi-Fi (iface null) or a bad prefix is "failed" without sending', async () => {
  const { log, run } = rig();
  assert.equal(await run({ iface: null }), 'failed');
  assert.equal(await run({ iface: { localIp: '192.168.1.20', cidrPrefix: 99 } }), 'failed');
  assert.equal(log.sends.length, 0);
});

test('an invalid MAC never sends', async () => {
  const { log, run } = rig();
  for (const mac of ['nope', '', '00:00:00:00:00:00']) assert.equal(await run({ mac }), 'failed', mac);
  assert.equal(log.sends.length, 0);
  assert.equal(log.probes, 0);
});
