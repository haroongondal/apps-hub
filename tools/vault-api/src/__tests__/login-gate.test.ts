import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { toBase64, tokenHash } from 'strongroom-core/src/format.ts';
import worker, { handle, type Env } from '../index.ts';
import { durableGate, FailureQueue, LoginGate, type Gate, type GateNamespace } from '../login-gate.ts';
import { d1FromNodeSqlite } from './d1-fake.ts';

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
const SETUP = 'setup-token-for-tests-0123456789abcdef';
const HEADER = JSON.stringify({ version: 1, kdf: { memoryKiB: 65536, iterations: 3, parallelism: 1 }, salt: 'AAECAwQFBgcICQoLDA0ODw==', passwordWrap: 'cA==', recoveryWrap: 'cg==', accountKey: true });
const tok = (n: number) => new Uint8Array(32).fill(n);
const LOGIN = tok(1);
const WRONG = tok(9);
const migration = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');

test('the queue gives each refusal its own delay when they arrive one after another', () => {
  let clock = NOW;
  const q = new FailureQueue(() => clock);
  for (const delay of [2000, 4000, 8000]) {
    assert.equal(q.reserve(delay), delay);
    clock += delay;
  }
});

test('refusals arriving together wait one after another, never side by side', () => {
  const q = new FailureQueue(() => NOW);
  assert.deepEqual([2000, 4000, 8000, 16000].map((d) => q.reserve(d)), [2000, 6000, 14000, 30000]);
});

test('a flood is capped at 10 minutes ahead, and a refusal never waits less than its own delay', () => {
  let clock = NOW;
  const q = new FailureQueue(() => clock);
  for (let i = 0; i < 100; i++) q.reserve(20000);
  assert.equal(q.reserve(20000), 10 * MIN);
  clock += 10 * MIN;
  assert.equal(q.reserve(20000), 20000);
});

test('the Durable Object class hands out back-to-back slots and ignores a bad delay', async () => {
  const gate = new LoginGate();
  const wait = async (q: string) => Number(await (await gate.fetch(new Request(`https://login-gate/?${q}`))).text());
  const first = await wait('delay=20000');
  const second = await wait('delay=20000');
  assert.ok(first > 19000 && first <= 20000, String(first));
  assert.ok(second - first > 19000, `${first} then ${second}`);
  const bad = await wait('delay=-5');
  assert.ok(bad <= second && bad > second - 1000, `bad delay adds nothing: ${bad}`);
});

test('durableGate reaches one named object and refuses an answer it cannot trust', async () => {
  const names: string[] = [];
  const object = new LoginGate();
  const ns: GateNamespace = { idFromName: (n) => (names.push(n), n), get: () => ({ fetch: (u) => object.fetch(new Request(u)) }) };
  const gate = durableGate(ns);
  assert.ok((await gate.reserve(2000)) > 1000);
  assert.ok((await gate.reserve(2000)) > 3000);
  assert.deepEqual(names, ['login-gate', 'login-gate']);

  for (const res of [new Response('nope'), new Response('-1'), new Response('5', { status: 500 })]) {
    await assert.rejects(async () => durableGate({ idFromName: (n) => n, get: () => ({ fetch: async () => res }) }).reserve(2000));
  }
});

// With `advance`, each sleep moves the clock on, as real waiting would; without it, everything happens in one instant.
function world(makeGate?: (now: () => number) => Gate, advance = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  let clock = NOW;
  const sleeps: number[] = [];
  const env: Env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: SETUP, LOGIN_GATE: makeGate?.(() => clock) };
  const deps = { now: () => clock, sleep: async (ms: number) => void (sleeps.push(ms), advance && (clock += ms)) };
  const call = async (token: Uint8Array) => (await handle(new Request('https://vault.example/v1/records', { headers: { authorization: `Bearer ${toBase64(token)}` } }), env, deps)).status;
  const setUp = async () => {
    const r = await handle(
      new Request('https://vault.example/v1/account', { method: 'PUT', headers: { authorization: `Bearer ${SETUP}` }, body: JSON.stringify({ header: HEADER, loginHash: tokenHash(LOGIN), recoveryHash: tokenHash(tok(2)), readHash: tokenHash(tok(3)) }) }),
      env,
      deps,
    );
    assert.equal(r.status, 200);
  };
  return { sleeps, call, setUp };
}

const queue = (now: () => number) => new FailureQueue(now);

test('through the gate, sequential refusals keep exactly the old backoff', async () => {
  const w = world(queue, true);
  await w.setUp();
  for (let i = 0; i < 11; i++) assert.equal(await w.call(WRONG), 401);
  assert.deepEqual(w.sleeps, [2000, 4000, 8000, 16000, 20000, 20000]);
});

test('parallel refusals are serialised by the gate; without it they all wait side by side', async () => {
  const run = async (makeGate?: typeof queue) => {
    const w = world(makeGate);
    await w.setUp();
    for (let i = 0; i < 5; i++) assert.equal(await w.call(WRONG), 401);
    const statuses = await Promise.all([1, 2, 3].map(() => w.call(WRONG)));
    assert.deepEqual(statuses, [401, 401, 401]);
    return [...w.sleeps].sort((a, b) => a - b);
  };
  assert.deepEqual(await run(), [2000, 4000, 8000]);
  const gated = await run(queue);
  assert.equal(gated.length, 3);
  assert.equal(gated[2], 2000 + 4000 + 8000);
  assert.ok(gated[0] < gated[1] && gated[1] < gated[2], String(gated));
});

test('the right token never waits, even behind a long queue of refusals', async () => {
  const w = world(queue);
  await w.setUp();
  for (let i = 0; i < 5; i++) await w.call(WRONG);
  await Promise.all(Array.from({ length: 20 }, () => w.call(WRONG)));
  const before = w.sleeps.length;
  assert.equal(await w.call(LOGIN), 200);
  assert.equal(w.sleeps.length, before);
});

test('a gate that fails still answers 401 after the old delay, never a 500', async () => {
  const w = world(() => ({ reserve: () => { throw new Error('object overloaded'); } }));
  await w.setUp();
  for (let i = 0; i < 6; i++) assert.equal(await w.call(WRONG), 401);
  assert.deepEqual(w.sleeps, [2000]);
});

test('the fetch entry point wraps the real Durable Object binding', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  const asked: string[] = [];
  const ns: GateNamespace = { idFromName: (n) => n, get: () => ({ fetch: async (u) => (asked.push(new URL(u).search), new Response('0')) }) };
  const env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: SETUP, LOGIN_GATE: ns };
  const put = new Request('https://vault.example/v1/account', { method: 'PUT', headers: { authorization: `Bearer ${SETUP}` }, body: JSON.stringify({ header: HEADER, loginHash: tokenHash(LOGIN), recoveryHash: tokenHash(tok(2)), readHash: tokenHash(tok(3)) }) });
  assert.equal((await worker.fetch(put, env)).status, 200);
  for (let i = 0; i < 6; i++) {
    const res = await worker.fetch(new Request('https://vault.example/v1/records', { headers: { authorization: `Bearer ${toBase64(WRONG)}` } }), env);
    assert.equal(res.status, 401);
  }
  assert.deepEqual(asked, ['?delay=2000']);
});
