import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PROPOSE_TASK, PROPOSE_TASK_RESULTS, validateExtras } from '@apps-hub/app-link-contract';

import {
  ROUTER_RESTART_TASK,
  deputyOutcomeMessage,
  parseDeputyOutcome,
  proposalExtras,
  routerRestartProposal,
  type DeputyProposalOutcome,
} from '../deputy-proposal.ts';

const fixture = new URL('../../../app-link-contract/fixtures/propose-task-extras.json', import.meta.url);
const cases = JSON.parse(fs.readFileSync(fixture, 'utf8')) as { name: string; spec: unknown; ok: boolean }[];

test('the contract fixture describes the live PROPOSE_TASK spec (DeputyProposalTest reads the same file)', () => {
  assert.ok(cases.length > 0);
  for (const c of cases) assert.deepEqual(c.spec, PROPOSE_TASK.extras, c.name);
});

test('the router restart proposal is valid PROPOSE_TASK extras: the fixed task alone', () => {
  const extras = proposalExtras(routerRestartProposal());
  assert.deepEqual(extras, { task: ROUTER_RESTART_TASK });
  assert.deepEqual(validateExtras(PROPOSE_TASK, extras), { ok: true, extras });
});

test('context goes along only when it has text', () => {
  assert.deepEqual(proposalExtras({ task: 't', context: '  ' }), { task: 't' });
  const extras = proposalExtras({ task: 't', context: 'TP-Link Archer C6' });
  assert.deepEqual(extras, { task: 't', context: 'TP-Link Archer C6' });
  assert.equal(validateExtras(PROPOSE_TASK, extras).ok, true);
});

test('over-long extras are refused, as the contract says', () => {
  assert.equal(validateExtras(PROPOSE_TASK, proposalExtras({ task: 'x'.repeat(300), context: '' })).ok, true);
  assert.equal(validateExtras(PROPOSE_TASK, proposalExtras({ task: 'x'.repeat(301), context: '' })).ok, false);
  assert.equal(validateExtras(PROPOSE_TASK, proposalExtras({ task: 't', context: 'x'.repeat(2001) })).ok, false);
});

test('the task names no credential, address or app', () => {
  assert.doesNotMatch(ROUTER_RESTART_TASK, /password|pin|admin:|\d+\.\d+\.\d+\.\d+|com\./i);
});

test('outcomes: Deputy result codes, native failures and iOS', () => {
  assert.equal(parseDeputyOutcome({ supported: true, outcome: PROPOSE_TASK_RESULTS.handed_over.code }), 'handed_over');
  assert.equal(parseDeputyOutcome({ supported: true, outcome: PROPOSE_TASK_RESULTS.cancelled.code }), 'cancelled');
  for (const o of ['not_installed', 'refused', 'invalid', 'busy'] as const) assert.equal(parseDeputyOutcome({ supported: true, outcome: o }), o);
  assert.equal(parseDeputyOutcome({ supported: true, outcome: 'ran_it' }), 'refused');
  assert.equal(parseDeputyOutcome({ supported: false }), 'not_supported');
  assert.equal(parseDeputyOutcome(null), 'not_supported');
});

test('every outcome but cancel has a plain message', () => {
  const all: DeputyProposalOutcome[] = ['handed_over', 'cancelled', 'not_installed', 'refused', 'invalid', 'busy', 'not_supported'];
  for (const o of all) {
    const m = deputyOutcomeMessage(o);
    if (o === 'cancelled') assert.equal(m, null);
    else assert.ok(m && m.length < 120 && !/intent|extra|activity|error/i.test(m), o);
  }
});
