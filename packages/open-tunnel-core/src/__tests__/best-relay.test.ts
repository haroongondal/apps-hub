import test from 'node:test';
import assert from 'node:assert/strict';

import { connectRankedRelay, type BestRelayOptions, type RelayAttempt } from '../best-relay.ts';
import { computeFitnessScore } from '../fitness.ts';
import { LatencyProber, type TcpProbeFn } from '../latency-prober.ts';
import { createVpnNode, withProbe, type VpnNode } from '../vpn-node.ts';

function relay(n: number, input: { pingMs?: number; speedBps?: number; uptimeMs?: number; numSessions?: number } = {}): VpnNode {
  return createVpnNode({
    hostName: `relay-${n}`,
    ip: `203.0.113.${n}`,
    port: 443,
    transportProto: 'tcp',
    score: 0,
    pingMs: input.pingMs ?? 50,
    speedBps: input.speedBps ?? 10_000_000,
    countryLong: 'Testland',
    countryShort: 'TS',
    numSessions: input.numSessions ?? 0,
    uptimeMs: input.uptimeMs ?? 3_600_000,
    operatorName: 'testsuite',
    ovpnConfigRaw: '',
  });
}

const rtts = (byIp: Record<string, number | null>): TcpProbeFn => async (ip) => byIp[ip] ?? null;

async function connectBestRelay(nodes: VpnNode[], prober: LatencyProber, options: BestRelayOptions) {
  const ranked = await prober.probeAndScoreNodes(nodes);
  return { ranked, result: await connectRankedRelay(ranked, options) };
}

test('the relay with the best fitness score is tried first, using the measured RTT', async () => {
  const slowButFast = relay(1, { speedBps: 100_000_000 });
  const nearby = relay(2, { speedBps: 10_000_000 });
  const probe = rtts({ '203.0.113.1': 400, '203.0.113.2': 10 });
  const tried: string[] = [];
  const { ranked, result } = await connectBestRelay([slowButFast, nearby], new LatencyProber(probe), {
    failedIds: new Set(),
    maxAttempts: 3,
    tryConnect: async (node) => {
      tried.push(node.hostName);
      return 'connected';
    },
  });
  const scored = [withProbe(slowButFast, { measuredRttMs: 400 }), withProbe(nearby, { measuredRttMs: 10 })];
  const best = scored.reduce((a, b) => (computeFitnessScore(a) >= computeFitnessScore(b) ? a : b));
  assert.equal(tried[0], best.hostName);
  assert.equal(ranked[0]!.fitnessScore, computeFitnessScore(best));
  assert.equal(result.outcome, 'connected');
});

test('a relay that never answered ranks below one that did, and keeps its listed ping in the score', async () => {
  const silent = relay(1, { pingMs: 1 });
  const answered = relay(2, { pingMs: 300 });
  const { ranked } = await connectBestRelay([silent, answered], new LatencyProber(rtts({ '203.0.113.2': 300 })), {
    failedIds: new Set(),
    maxAttempts: 2,
    tryConnect: async () => 'connected',
  });
  assert.deepEqual(ranked.map((node) => node.hostName), ['relay-2', 'relay-1']);
  assert.equal(ranked[1]!.fitnessScore, computeFitnessScore(silent));
});

test('a failed start falls back to the next relay, and a thrown start counts as failed', async () => {
  const nodes = [relay(1), relay(2), relay(3)];
  const outcomes: Record<string, () => Promise<RelayAttempt>> = {
    'relay-1': async () => 'failed',
    'relay-2': async () => {
      throw new Error('engine refused');
    },
    'relay-3': async () => 'connected',
  };
  const result = await connectRankedRelay(nodes, {
    failedIds: new Set(),
    maxAttempts: 6,
    tryConnect: (node) => outcomes[node.hostName]!(),
  });
  assert.deepEqual(result, { outcome: 'connected', node: nodes[2], attempts: 3 });
});

test('attempts are bounded, relays that failed before are skipped, and a cancel stops the pass', async () => {
  const nodes = [relay(1), relay(2), relay(3), relay(4)];
  const tried: string[] = [];
  const failing = { failedIds: new Set([nodes[0]!.id]), maxAttempts: 2, tryConnect: async (node: VpnNode) => {
    tried.push(node.hostName);
    return 'failed' as const;
  } };
  assert.deepEqual(await connectRankedRelay(nodes, failing), { outcome: 'all-failed', attempts: 2 });
  assert.deepEqual(tried, ['relay-2', 'relay-3']);

  const cancelled = await connectRankedRelay(nodes, { failedIds: new Set(), maxAttempts: 6, tryConnect: async () => 'cancelled' });
  assert.deepEqual(cancelled, { outcome: 'cancelled', attempts: 1 });

  const none = await connectRankedRelay(nodes, { failedIds: new Set(nodes.map((n) => n.id)), maxAttempts: 6, tryConnect: async () => 'connected' });
  assert.deepEqual(none, { outcome: 'none-left' });
});

test('probing is bounded to 8 at a time by default', async () => {
  const nodes = Array.from({ length: 20 }, (_, i) => relay(i + 1));
  let live = 0;
  let peak = 0;
  const probe: TcpProbeFn = async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((resolve) => setTimeout(resolve, 5));
    live -= 1;
    return 20;
  };
  await connectBestRelay(nodes, new LatencyProber(probe), { failedIds: new Set(), maxAttempts: 1, tryConnect: async () => 'connected' });
  assert.equal(peak, 8);
});
