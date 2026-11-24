import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERROR_KINDS } from 'ai-hub-client/src/contract.ts';

import { HUB_COPY, hubGate, hubStateOf, READY_MS, WAITING_COPY, WAITING_LINE, type HubState } from '../nexus/hub-state.ts';

test('only the four kinds the owner can fix are hub states', () => {
  const found = Object.fromEntries(ERROR_KINDS.map((k) => [k, hubStateOf(k)]));
  assert.deepEqual(found, {
    'hub-missing': 'missing',
    'not-allowed': 'not-allowed',
    version: 'version',
    'no-key': 'no-key',
    'too-large': null,
    invalid: null,
    busy: null,
    cancelled: null,
    timeout: null,
    'provider-error': null,
  });
});

test('each problem says what to do, in plain words, and opens the right app', () => {
  assert.deepEqual(HUB_COPY.missing, { title: 'AI needs AI hub', body: HUB_COPY.missing.body, button: 'Install AI hub', opens: 'store' });
  assert.equal(HUB_COPY['not-allowed'].title, 'Allow Nexus in AI hub');
  assert.equal(HUB_COPY['not-allowed'].opens, 'ai-hub');
  assert.equal(HUB_COPY['no-key'].title, 'Add a key in AI hub');
  assert.equal(HUB_COPY['no-key'].opens, 'ai-hub');
  for (const c of Object.values(HUB_COPY)) assert.doesNotMatch(`${c.title} ${c.body} ${c.button}`, /error|kind|API|key not|HTTP|provider/i);
});

test('a hub that keeps not answering is named in plain words and points at AI hub', () => {
  assert.equal(WAITING_LINE, 'Waiting for AI hub to answer');
  assert.equal(WAITING_COPY.opens, 'ai-hub');
  assert.doesNotMatch(`${WAITING_COPY.title} ${WAITING_COPY.body}`, /error|kind|provider|HTTP/i);
});

function gateWith(states: HubState[]) {
  const clock = { t: 0 };
  const checks: number[] = [];
  const gate = hubGate({
    check: async () => (checks.push(clock.t), states[Math.min(checks.length, states.length) - 1]),
    now: () => clock.t,
  });
  return { gate, clock, checks };
}

test('a problem stays until the owner comes back; a ready answer is trusted for a minute', async () => {
  const g = gateWith(['not-allowed', 'ready']);
  assert.equal(await g.gate.state(), 'not-allowed');
  g.clock.t += 10 * READY_MS;
  assert.equal(await g.gate.state(), 'not-allowed');
  assert.equal(g.checks.length, 1);
  g.gate.forget();
  assert.equal(await g.gate.state(), 'ready');
  g.clock.t += READY_MS - 1;
  assert.equal(await g.gate.state(), 'ready');
  assert.equal(g.checks.length, 2);
  g.clock.t += 1;
  await g.gate.state();
  assert.equal(g.checks.length, 3);
});

test('a call that said no key moves the gate until the next look', async () => {
  const g = gateWith(['ready']);
  assert.equal(await g.gate.state(), 'ready');
  g.gate.set('no-key');
  assert.equal(await g.gate.state(), 'no-key');
  g.gate.forget();
  assert.equal(await g.gate.state(), 'ready');
});
