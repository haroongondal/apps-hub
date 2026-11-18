import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMON_PORTS, PORT_CHECK_CONCURRENCY, checkPorts, webUrlFor } from '../port-check.ts';
import type { ProbeOutcome } from '../model.ts';

function fakeBinding(outcomes: Record<number, ProbeOutcome | 'throw'>) {
  let inFlight = 0;
  let peak = 0;
  return {
    get peak() {
      return peak;
    },
    async measureTcpHandshake(_ip: string, port: number, _timeoutMs: number) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const outcome = outcomes[port] ?? 'timeout';
      if (outcome === 'throw') throw new Error('bridge down');
      return { outcome, rttMs: outcome === 'open' || outcome === 'refused' ? 1 : null };
    },
  };
}

test('only open ports count; refused, timeout and errors read as closed', async () => {
  const binding = fakeBinding({ 22: 'refused', 80: 'open', 631: 'open', 445: 'throw', 23: 'unreachable' });
  const open = await checkPorts(binding, '192.168.1.5');
  assert.deepEqual(open.map((p) => p.port), [80, 631]);
});

test('keeps at most PORT_CHECK_CONCURRENCY probes in flight', async () => {
  const binding = fakeBinding({});
  await checkPorts(binding, '192.168.1.5');
  assert.equal(binding.peak, PORT_CHECK_CONCURRENCY);
});

test('webUrlFor drops default ports and refuses non-web ports', () => {
  const byPort = (port: number) => COMMON_PORTS.find((p) => p.port === port)!;
  assert.equal(webUrlFor('10.0.0.2', byPort(80)), 'http://10.0.0.2/');
  assert.equal(webUrlFor('10.0.0.2', byPort(443)), 'https://10.0.0.2/');
  assert.equal(webUrlFor('10.0.0.2', byPort(8443)), 'https://10.0.0.2:8443/');
  assert.equal(webUrlFor('10.0.0.2', byPort(22)), null);
});
