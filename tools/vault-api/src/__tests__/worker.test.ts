import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { toBase64, tokenHash } from 'strongroom-core';
import { handle, type Env } from '../index.ts';
import { d1FromNodeSqlite } from './d1-fake.ts';

const NOW = 1_800_000_000_000;
const SETUP = 'setup-token-for-tests-0123456789abcdef';
const tok = (n: number) => new Uint8Array(32).fill(n);
const LOGIN = tok(1);
const RECOVERY = tok(2);
const READ = tok(3);
const NEW_LOGIN = tok(4);
const KDF = { memoryKiB: 65536, iterations: 3, parallelism: 1 };
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const header = (extra: object = { accountKey: true }) =>
  JSON.stringify({ version: 1, kdf: KDF, salt: SALT, passwordWrap: 'cA==', recoveryWrap: 'cg==', ...extra });
const HEADER = header();
const migration = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
const escrowMigration = readFileSync(new URL('../../migrations/0002_escrow.sql', import.meta.url), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ct = (s: string) => btoa(s);

type Body = Record<string, any>;

function world(setupToken = SETUP) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(escrowMigration);
  const env: Env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: setupToken };
  const sleeps: number[] = [];
  const deps = { now: () => NOW, sleep: async (ms: number) => void sleeps.push(ms) };
  const send = (method: string, path: string, auth?: Uint8Array | string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (auth !== undefined) headers.authorization = `Bearer ${typeof auth === 'string' ? auth : toBase64(auth)}`;
    const init = { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) };
    return handle(new Request(`https://vault.example${path}`, init), env, deps);
  };
  const call = async (method: string, path: string, auth?: Uint8Array | string, body?: unknown) => {
    const res = await send(method, path, auth, body);
    return { status: res.status, body: (await res.json()) as Body };
  };
  const rows = () => sqlite.prepare('SELECT id, rev, ciphertext FROM records ORDER BY id').all().map((r) => ({ ...(r as object) }));
  const push = (token: Uint8Array, upserts: { id: string; baseRev: number; ciphertext: string }[]) =>
    call('POST', '/v1/records', token, { upserts });
  return { sqlite, env, sleeps, send, call, rows, push };
}

const account = (over: object = {}) => ({
  header: HEADER,
  loginHash: tokenHash(LOGIN),
  recoveryHash: tokenHash(RECOVERY),
  readHash: tokenHash(READ),
  ...over,
});

async function setUp(w: ReturnType<typeof world>) {
  const r = await w.call('PUT', '/v1/account', SETUP, account());
  assert.deepEqual(r, { status: 200, body: { headerRev: 1 } });
}

test('preloginIs404BeforeSetupThenPublic', async () => {
  const w = world();
  assert.equal((await w.call('GET', '/v1/prelogin')).status, 404);
  await setUp(w);
  assert.deepEqual(await w.call('GET', '/v1/prelogin'), {
    status: 200,
    body: { version: 1, kdf: KDF, salt: SALT, accountKey: true },
  });

  const plain = world();
  await plain.call('PUT', '/v1/account', SETUP, account({ header: header({}) }));
  assert.equal((await plain.call('GET', '/v1/prelogin')).body.accountKey, false);
});

test('setupNeedsSetupTokenAndWorksOnce', async () => {
  const w = world();
  assert.equal((await w.call('PUT', '/v1/account', 'x'.repeat(SETUP.length), account())).status, 401);
  assert.equal((await w.call('PUT', '/v1/account', SETUP.slice(0, 16), account())).status, 401);
  assert.equal((await w.call('PUT', '/v1/account', undefined, account())).status, 401);
  assert.equal((await w.call('GET', '/v1/prelogin')).status, 404);
  await setUp(w);
  assert.equal((await w.call('PUT', '/v1/account', SETUP, account())).status, 403);

  const unset = world('');
  assert.equal((await unset.call('PUT', '/v1/account', '', account())).status, 401);
  const short = world('short-setup-token');
  assert.equal((await short.call('PUT', '/v1/account', 'short-setup-token', account())).status, 401);
});

test('secondSetupIsRefusedEvenAfterAccountRowIsDeleted', async () => {
  const w = world();
  await setUp(w);
  w.sqlite.exec('DELETE FROM account');
  assert.equal((await w.call('GET', '/v1/prelogin')).status, 404);
  assert.equal((await w.call('PUT', '/v1/account', SETUP, account())).status, 403);
  assert.equal((await w.call('GET', '/v1/prelogin')).status, 404);
});

test('loginAndRecoveryTokensWorkReadTokenOnlyReads', async () => {
  const w = world();
  await setUp(w);
  let n = 0;
  for (const token of [LOGIN, RECOVERY]) {
    assert.equal((await w.call('GET', '/v1/records', token)).status, 200);
    assert.equal((await w.push(token, [{ id: id(++n), baseRev: 0, ciphertext: ct('x') }])).status, 200);
  }
  const read = await w.call('GET', '/v1/records', READ);
  assert.equal(read.status, 200);
  assert.equal(read.body.records.length, 2);
  assert.equal((await w.push(READ, [{ id: id(9), baseRev: 0, ciphertext: ct('x') }])).status, 401);
  assert.equal((await w.call('PUT', '/v1/account', READ, account({ ifRev: 1 }))).status, 401);
  assert.equal((await w.call('GET', '/v1/records')).status, 401);
  assert.equal((await w.call('GET', '/v1/records', NEW_LOGIN)).status, 401);
  assert.equal(w.rows().length, 2);
});

test('staleBaseRevIs409AndNothingIsWritten', async () => {
  const w = world();
  await setUp(w);
  await w.push(LOGIN, [{ id: id(1), baseRev: 0, ciphertext: ct('a1') }, { id: id(2), baseRev: 0, ciphertext: ct('b1') }]);
  const before = w.rows();

  const stale = await w.push(LOGIN, [{ id: id(1), baseRev: 1, ciphertext: ct('a2') }, { id: id(2), baseRev: 1, ciphertext: ct('b2') }]);
  assert.deepEqual(stale, { status: 409, body: { conflicts: [{ id: id(2), rev: 2 }] } });
  assert.deepEqual(w.rows(), before);

  // Another device's push lands after this push read the revisions and before it writes.
  const db = w.env.DB;
  const realBatch = db.batch.bind(db);
  let interleave = true;
  db.batch = async (stmts) => {
    if (interleave) {
      interleave = false;
      assert.equal((await w.push(RECOVERY, [{ id: id(2), baseRev: 2, ciphertext: ct('b-other') }])).status, 200);
    }
    return realBatch(stmts);
  };
  const raced = await w.push(LOGIN, [{ id: id(1), baseRev: 1, ciphertext: ct('a2') }, { id: id(2), baseRev: 2, ciphertext: ct('b2') }]);
  assert.equal(interleave, false);
  assert.deepEqual(raced, { status: 409, body: { conflicts: [{ id: id(2), rev: 3 }] } });
  assert.deepEqual(w.rows(), [before[0], { id: id(2), rev: 3, ciphertext: ct('b-other') }]);

  const next = await w.push(LOGIN, [{ id: id(1), baseRev: 1, ciphertext: ct('a2') }]);
  assert.deepEqual(next.body, { revs: [{ id: id(1), rev: 4 }], latestRev: 4 });
});

test('newIdWithBaseRevZeroConflictsIfItExists', async () => {
  const w = world();
  await setUp(w);
  assert.equal((await w.push(LOGIN, [{ id: id(1), baseRev: 0, ciphertext: ct('first') }])).status, 200);
  assert.deepEqual(await w.push(LOGIN, [{ id: id(1), baseRev: 0, ciphertext: ct('again') }]), {
    status: 409,
    body: { conflicts: [{ id: id(1), rev: 1 }] },
  });
  assert.deepEqual(await w.push(LOGIN, [{ id: id(7), baseRev: 3, ciphertext: ct('never existed') }]), {
    status: 409,
    body: { conflicts: [{ id: id(7), rev: 0 }] },
  });
  assert.deepEqual(w.rows(), [{ id: id(1), rev: 1, ciphertext: ct('first') }]);
});

test('revsAreIncreasingAcrossBatches', async () => {
  const w = world();
  await setUp(w);
  const a = await w.push(LOGIN, [{ id: id(1), baseRev: 0, ciphertext: ct('1') }, { id: id(2), baseRev: 0, ciphertext: ct('2') }]);
  assert.deepEqual(a.body, { revs: [{ id: id(1), rev: 1 }, { id: id(2), rev: 2 }], latestRev: 2 });
  const b = await w.push(LOGIN, [{ id: id(3), baseRev: 0, ciphertext: ct('3') }]);
  assert.deepEqual(b.body, { revs: [{ id: id(3), rev: 3 }], latestRev: 3 });
  const c = await w.push(RECOVERY, [{ id: id(1), baseRev: 1, ciphertext: ct('1b') }]);
  assert.deepEqual(c.body, { revs: [{ id: id(1), rev: 4 }], latestRev: 4 });
});

test('pullReturnsOnlyNewerAscendingWithMore', async () => {
  const w = world();
  await setUp(w);
  for (let n = 1; n <= 5; n++) await w.push(LOGIN, [{ id: id(n), baseRev: 0, ciphertext: ct(`r${n}`) }]);
  const page = async (since: number) => (await w.call('GET', `/v1/records?since=${since}&limit=2`, READ)).body;

  const p1 = await page(0);
  assert.deepEqual(p1.records.map((r: Body) => r.rev), [1, 2]);
  assert.deepEqual(p1.records[0], { id: id(1), rev: 1, ciphertext: ct('r1'), updatedAt: NOW });
  assert.equal(p1.more, true);
  assert.equal(p1.latestRev, 5);
  assert.equal(p1.header, HEADER);
  assert.equal(p1.headerRev, 1);
  assert.deepEqual((await page(2)).records.map((r: Body) => r.rev), [3, 4]);
  const p3 = await page(4);
  assert.deepEqual(p3.records.map((r: Body) => r.id), [id(5)]);
  assert.equal(p3.more, false);

  await w.push(LOGIN, [{ id: id(1), baseRev: 1, ciphertext: ct('r1b') }]);
  const p4 = await page(5);
  assert.deepEqual(p4.records.map((r: Body) => [r.id, r.rev]), [[id(1), 6]]);
  assert.equal(p4.more, false);
  assert.equal((await w.call('GET', '/v1/records', READ)).body.records.length, 5);

  for (const q of ['limit=501', 'limit=0', 'since=-1', 'since=1.5', 'since=abc']) {
    assert.equal((await w.call('GET', `/v1/records?${q}`, READ)).status, 400, q);
  }
});

test('tombstoneIsJustARecord', async () => {
  const w = world();
  await setUp(w);
  await w.push(LOGIN, [{ id: id(1), baseRev: 0, ciphertext: ct('live entry') }]);
  const t = await w.push(LOGIN, [{ id: id(1), baseRev: 1, ciphertext: ct('sealed tombstone') }]);
  assert.deepEqual(t.body.revs, [{ id: id(1), rev: 2 }]);
  assert.equal((await w.call('DELETE', `/v1/records/${id(1)}`, LOGIN)).status, 404);
  assert.equal((await w.call('DELETE', '/v1/records', LOGIN)).status, 404);
  assert.deepEqual(w.rows(), [{ id: id(1), rev: 2, ciphertext: ct('sealed tombstone') }]);
  assert.deepEqual((await w.call('GET', '/v1/records?since=1', READ)).body.records.map((r: Body) => r.ciphertext), [ct('sealed tombstone')]);
});

test('headerCompareAndSwap', async () => {
  const w = world();
  await setUp(w);
  const next = header({ salt: 'EBESExQVFhcYGRobHB0eHw==', accountKey: true });
  const change = account({ header: next, loginHash: tokenHash(NEW_LOGIN) });

  assert.equal((await w.call('PUT', '/v1/account', LOGIN, { ...change, ifRev: 2 })).status, 409);
  assert.equal((await w.call('PUT', '/v1/account', LOGIN, { ...change, ifRev: 0 })).status, 409);
  assert.equal((await w.call('PUT', '/v1/account', LOGIN, change)).status, 400);
  const same = await w.call('GET', '/v1/records', LOGIN);
  assert.equal(same.body.header, HEADER);
  assert.equal(same.body.headerRev, 1);

  assert.deepEqual(await w.call('PUT', '/v1/account', LOGIN, { ...change, ifRev: 1 }), { status: 200, body: { headerRev: 2 } });
  assert.equal((await w.call('GET', '/v1/records', LOGIN)).status, 401);
  const after = await w.call('GET', '/v1/records', NEW_LOGIN);
  assert.equal(after.status, 200);
  assert.equal(after.body.header, next);
  assert.equal(after.body.headerRev, 2);
  assert.equal((await w.call('GET', '/v1/records', RECOVERY)).status, 200);
  assert.deepEqual(await w.call('PUT', '/v1/account', RECOVERY, { ...change, ifRev: 2 }), { status: 200, body: { headerRev: 3 } });
});

test('updateWithoutRecoveryHashKeepsIt', async () => {
  const w = world();
  await setUp(w);
  const { recoveryHash: _, ...change } = account({ loginHash: tokenHash(NEW_LOGIN) });
  assert.equal((await w.call('PUT', '/v1/account', LOGIN, { ...change, recoveryHash: 'abc', ifRev: 1 })).status, 400);
  assert.deepEqual(await w.call('PUT', '/v1/account', LOGIN, { ...change, ifRev: 1 }), { status: 200, body: { headerRev: 2 } });
  assert.equal((await w.call('GET', '/v1/records', RECOVERY)).status, 200);

  const NEW_RECOVERY = tok(5);
  const replaced = { ...change, recoveryHash: tokenHash(NEW_RECOVERY), ifRev: 2 };
  assert.deepEqual(await w.call('PUT', '/v1/account', NEW_LOGIN, replaced), { status: 200, body: { headerRev: 3 } });
  assert.equal((await w.call('GET', '/v1/records', RECOVERY)).status, 401);
  assert.equal((await w.call('GET', '/v1/records', NEW_RECOVERY)).status, 200);
});

test('inputLimits', async () => {
  const w = world();
  for (const bad of [
    account({ loginHash: 'abc' }),
    account({ readHash: undefined }),
    account({ recoveryHash: undefined }),
    account({ header: 'not json' }),
    account({ header: header({ accountKey: 'yes' }) }),
    account({ header: header({ pad: 'x'.repeat(4096) }) }),
  ]) {
    assert.equal((await w.call('PUT', '/v1/account', SETUP, bad)).status, 400);
  }
  await setUp(w);

  const ok = (n: number) => ({ id: id(n), baseRev: 0, ciphertext: ct('x') });
  const cases: [number, unknown, Uint8Array | string][] = [
    [413, { upserts: [{ ...ok(1), ciphertext: 'A'.repeat(90_004) }] }, LOGIN],
    [413, { upserts: Array.from({ length: 101 }, (_, i) => ok(i + 1)) }, LOGIN],
    [400, { upserts: [{ ...ok(1), id: 'not-a-uuid' }] }, LOGIN],
    [400, { upserts: [{ ...ok(1), id: '0000000A-0000-4000-8000-000000000001' }] }, LOGIN],
    [400, { upserts: [{ ...ok(1), ciphertext: 'not base64!' }] }, LOGIN],
    [400, { upserts: [{ ...ok(1), ciphertext: '' }] }, LOGIN],
    [400, { upserts: [{ ...ok(1), baseRev: -1 }] }, LOGIN],
    [400, { upserts: [{ ...ok(1), baseRev: 1.5 }] }, LOGIN],
    [400, { upserts: [ok(1), ok(1)] }, LOGIN],
    [400, { upserts: [] }, LOGIN],
    [400, { nope: true }, LOGIN],
    [400, '{not json', LOGIN],
    [401, { upserts: [ok(1)] }, new Uint8Array(31).fill(1)],
    [401, { upserts: [ok(1)] }, new Uint8Array(33).fill(1)],
    [401, { upserts: [ok(1)] }, 'not base64!'],
  ];
  for (const [status, body, token] of cases) {
    const r = await w.call('POST', '/v1/records', token, body);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.deepEqual(w.rows(), []);

  assert.equal((await w.push(LOGIN, [{ ...ok(1), ciphertext: 'A'.repeat(90_000) }])).status, 200);
  assert.equal((await w.push(LOGIN, Array.from({ length: 100 }, (_, i) => ok(i + 2)))).status, 200);
  assert.equal(w.rows().length, 101);
});

test('failedAuthBacksOffButCorrectTokenIsNeverDelayed', async () => {
  const w = world();
  await setUp(w);
  for (let i = 0; i < 5; i++) assert.equal((await w.call('GET', '/v1/records', NEW_LOGIN)).status, 401);
  assert.deepEqual(w.sleeps, []);
  for (let i = 0; i < 6; i++) assert.equal((await w.call('GET', '/v1/records', NEW_LOGIN)).status, 401);
  assert.deepEqual(w.sleeps, [2000, 4000, 8000, 16000, 20000, 20000]); // capped below both clients' 30 s timeouts, so a 401 always arrives

  assert.equal((await w.call('GET', '/v1/records', LOGIN)).status, 200);
  assert.equal(w.sleeps.length, 6);
  for (let i = 0; i < 5; i++) assert.equal((await w.call('PUT', '/v1/account', 'wrong-setup-token-0123456789abcdef', account())).status, 401);
  assert.equal(w.sleeps.length, 6);
  assert.equal((await w.call('GET', '/v1/records', READ)).status, 200);
  assert.equal(w.sleeps.length, 6);
});

test('noCorsHeadersAndNoStoreCaching', async () => {
  const w = world();
  const requests: [string, string, (Uint8Array | string)?, unknown?][] = [
    ['GET', '/v1/prelogin'],
    ['PUT', '/v1/account', SETUP, account()],
    ['PUT', '/v1/account', SETUP, account()],
    ['GET', '/v1/prelogin'],
    ['OPTIONS', '/v1/records'],
    ['GET', '/v1/records', READ],
    ['GET', '/v1/records', NEW_LOGIN],
    ['POST', '/v1/records', LOGIN, { upserts: [{ id: id(1), baseRev: 0, ciphertext: ct('x') }] }],
    ['POST', '/v1/records', LOGIN, { upserts: [{ id: id(1), baseRev: 0, ciphertext: ct('x') }] }],
    ['POST', '/v1/records', LOGIN, '{'],
    ['GET', '/'],
  ];
  const seen = new Set<number>();
  for (const [method, path, auth, body] of requests) {
    const res = await w.send(method, path, auth, body);
    seen.add(res.status);
    assert.equal(res.headers.get('cache-control'), 'private, no-store', `${method} ${path}`);
    assert.equal(res.headers.get('content-type'), 'application/json');
    const cors: string[] = [];
    res.headers.forEach((_, k) => k.startsWith('access-control-') && cors.push(k));
    assert.deepEqual(cors, []);
  }
  assert.deepEqual([...seen].sort(), [200, 400, 401, 403, 404, 409]);
});

test('responsesMatchTheSharedSamples', async () => {
  const url = new URL('../../../../apps/strongroom/modules/strongroom-vault/android/src/test/resources/sync-samples.json', import.meta.url);
  const samples = JSON.parse(readFileSync(url, 'utf8')) as Record<string, { request: Body; response: Body }>;
  const order = ['accountCreate', 'prelogin', 'push', 'pull', 'pushConflict', 'accountUpdate', 'accountUpdateKeepRecovery'];
  assert.deepEqual(Object.keys(samples).sort(), [...order].sort());

  const w = world();
  for (const name of order) {
    const { request, response } = samples[name];
    const headers: Record<string, string> = request.authorization ? { authorization: request.authorization } : {};
    const res = await handle(
      new Request(`https://vault.example${request.path}`, { method: request.method, headers, body: request.body && JSON.stringify(request.body) }),
      w.env,
      { now: () => NOW },
    );
    assert.deepEqual({ status: res.status, body: await res.json() }, response, name);
  }
});
