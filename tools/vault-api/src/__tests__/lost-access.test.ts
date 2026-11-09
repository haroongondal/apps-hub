import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'strongroom-core/src/crypto.ts';
import { toBase64, tokenHash } from 'strongroom-core/src/format.ts';
import { handle, type Env, type Mailer } from '../index.ts';
import { d1FromNodeSqlite } from './d1-fake.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SETUP = 'setup-token-for-tests-0123456789abcdef';
const KDF = { memoryKiB: 65536, iterations: 3, parallelism: 1 };
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const HEADER = JSON.stringify({ version: 1, kdf: KDF, salt: SALT, passwordWrap: 'cA==', recoveryWrap: 'cg==', accountKey: true });
const tok = (n: number) => new Uint8Array(32).fill(n);
const LOGIN = tok(1);
const RECOVERY = tok(2);
const READ = tok(3);
const migration1 = readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8');
const migration2 = readFileSync(new URL('../../migrations/0002_escrow.sql', import.meta.url), 'utf8');

type Body = Record<string, any>;
const account = (over: object = {}) => ({ header: HEADER, loginHash: tokenHash(LOGIN), recoveryHash: tokenHash(RECOVERY), readHash: tokenHash(READ), ...over });
const tokenParam = (mailText: string) => /t=([^&\s]+)/.exec(mailText)![1];

function world() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration1);
  sqlite.exec(migration2);
  const mails: { to: string; subject: string; text: string }[] = [];
  let failMail = false;
  let clock = NOW;
  const mail: Mailer = {
    async send(to, subject, text) {
      if (failMail) throw new Error('mail down');
      mails.push({ to, subject, text });
    },
  };
  const env: Env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: SETUP, PUBLIC_URL: 'https://vault.example' };
  const deps = { now: () => clock, sleep: async () => {}, mail };
  const send = (method: string, path: string, auth?: Uint8Array | string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (auth !== undefined) headers.authorization = `Bearer ${typeof auth === 'string' ? auth : toBase64(auth)}`;
    return handle(new Request(`https://vault.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps);
  };
  const call = async (method: string, path: string, auth?: Uint8Array | string, body?: unknown) => {
    const res = await send(method, path, auth, body);
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: (ct.includes('json') ? await res.json() : await res.text()) as Body };
  };
  const plain = <T>(row: unknown): T | undefined => (row ? ({ ...(row as object) } as T) : undefined);
  const escrowRow = () => plain<{ email: string; blob: string }>(sqlite.prepare('SELECT email, blob FROM escrow').all()[0]);
  const lostRow = () =>
    plain<{ claimHash: string; confirmHash: string; requestedAt: number; releaseAt: number | null; cancelled: number }>(
      sqlite.prepare('SELECT claim_hash AS claimHash, confirm_hash AS confirmHash, requested_at AS requestedAt, release_at AS releaseAt, cancelled FROM lost_request').all()[0],
    );
  return { sqlite, mails, call, escrowRow, lostRow, setClock: (ms: number) => void (clock = ms), failMail: (v: boolean) => void (failMail = v) };
}

async function setUp(w: ReturnType<typeof world>) {
  const r = await w.call('PUT', '/v1/account', SETUP, account());
  assert.deepEqual(r, { status: 200, body: { headerRev: 1 } });
}

// Rotates recoveryHash to a fresh token while enrolling escrow, as a real enrollment call must.
async function enroll(w: ReturnType<typeof world>, email = 'owner@example.com', blobText = 'sealed-blob') {
  const newRecovery = tok(20);
  const r = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(newRecovery) }), ifRev: 1, escrow: { email, blob: btoa(blobText), code: 'CODE-WORD' } });
  assert.equal(r.status, 200);
  w.mails.length = 0;
  return newRecovery;
}

test('enrolling stores the blob and mails the code once, and the code is not in the database', async () => {
  const w = world();
  await setUp(w);
  const r = await w.call('PUT', '/v1/account', LOGIN, {
    ...account({ recoveryHash: tokenHash(tok(9)) }),
    ifRev: 1,
    escrow: { email: 'owner@example.com', blob: btoa('sealed'), code: 'ABCD-EFGH' },
  });
  assert.equal(r.status, 200);
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to, 'owner@example.com');
  assert.match(w.mails[0].text, /ABCD-EFGH/);
  assert.deepEqual(w.escrowRow(), { email: 'owner@example.com', blob: btoa('sealed') });
  assert.ok(!JSON.stringify(w.sqlite.prepare('SELECT * FROM escrow').all()).includes('ABCD-EFGH'));
});

test('a mail failure answers 502 and stores nothing', async () => {
  const w = world();
  await setUp(w);
  w.failMail(true);
  const r = await w.call('PUT', '/v1/account', LOGIN, {
    ...account({ recoveryHash: tokenHash(tok(9)) }),
    ifRev: 1,
    escrow: { email: 'owner@example.com', blob: btoa('sealed'), code: 'ABCD-EFGH' },
  });
  assert.equal(r.status, 502);
  assert.equal(w.escrowRow(), undefined);
  assert.equal(w.mails.length, 0);
  assert.equal((await w.call('GET', '/v1/records', RECOVERY)).status, 200);
});

test('escrow without a recoveryHash is rejected', async () => {
  const w = world();
  await setUp(w);
  const { recoveryHash: _drop, ...rest } = account();
  const r = await w.call('PUT', '/v1/account', LOGIN, { ...rest, ifRev: 1, escrow: { email: 'owner@example.com', blob: btoa('sealed'), code: 'ABCD' } });
  assert.equal(r.status, 400);
  assert.equal(w.mails.length, 0);
  assert.equal(w.escrowRow(), undefined);
});

test('a changed recoveryHash deletes the escrow unless the same call carries a new one', async () => {
  const w = world();
  await setUp(w);
  const newRecovery = await enroll(w);
  assert.ok(w.escrowRow());

  const same = await w.call('PUT', '/v1/account', newRecovery, { ...account({ recoveryHash: tokenHash(newRecovery) }), ifRev: 2 });
  assert.equal(same.status, 200);
  assert.ok(w.escrowRow());

  const changed = await w.call('PUT', '/v1/account', newRecovery, { ...account({ recoveryHash: tokenHash(tok(30)) }), ifRev: 3 });
  assert.equal(changed.status, 200);
  assert.equal(w.escrowRow(), undefined);
});

test('request with no escrow answers 200 and sends no mail', async () => {
  const w = world();
  await setUp(w);
  const r = await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(w.mails.length, 0);
  assert.equal(w.lostRow(), undefined);
});

test('request with escrow mails one confirm link', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  const claimHash = toBase64(randomBytes(32));
  const r = await w.call('POST', '/v1/lost/request', undefined, { claimHash });
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(w.mails.length, 1);
  assert.match(w.mails[0].text, /\/v1\/lost\/confirm\?t=/);
  const lost = w.lostRow();
  assert.equal(lost?.claimHash, claimHash);
  assert.equal(lost?.releaseAt, null);
  assert.equal(lost?.cancelled, 0);
});

test('a second request within an hour sends no second mail', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  const claimHash1 = toBase64(randomBytes(32));
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: claimHash1 });
  assert.equal(w.mails.length, 1);
  w.setClock(NOW + HOUR - 1000);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  assert.equal(w.mails.length, 1);
  assert.equal(w.lostRow()?.claimHash, claimHash1);
});

test('confirming starts a 24-hour wait and mails a notice', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  const r = await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  assert.equal(r.status, 200);
  assert.match(String(r.body), /Confirmed/);
  assert.equal(w.mails.length, 2);
  assert.match(w.mails[1].text, /\/v1\/lost\/cancel\?t=/);
  assert.equal(w.lostRow()?.releaseAt, NOW + DAY);
});

test('a wrong confirm token changes nothing', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  assert.equal(w.mails.length, 1);
  const r = await w.call('GET', `/v1/lost/confirm?t=${encodeURIComponent(toBase64(randomBytes(32)))}`);
  assert.equal(r.status, 200);
  assert.match(String(r.body), /no longer valid/);
  assert.equal(w.mails.length, 1);
  assert.equal(w.lostRow()?.releaseAt, null);
});

test('release before 24 hours is waiting with the release time', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  const claim = randomBytes(32);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(claim) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  w.setClock(NOW + DAY - 1000);
  const r = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(claim) });
  assert.deepEqual(r, { status: 200, body: { state: 'waiting', releaseAt: NOW + DAY } });
});

test('release at 24 hours returns the blob', async () => {
  const w = world();
  await setUp(w);
  await enroll(w, 'owner@example.com', 'sealed-blob-bytes');
  const claim = randomBytes(32);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(claim) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  w.setClock(NOW + DAY);
  const r = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(claim) });
  assert.deepEqual(r, { status: 200, body: { state: 'ready', blob: btoa('sealed-blob-bytes') } });
});

test('release with a wrong claim looks the same as no request', async () => {
  const w = world();
  const none = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(randomBytes(32)) });
  assert.deepEqual(none, { status: 200, body: { state: 'waiting', releaseAt: null } });

  await setUp(w);
  await enroll(w);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(randomBytes(32)) });
  const wrong = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(randomBytes(32)) });
  assert.deepEqual(wrong, none);
});

test('release after cancel is refused', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  const claim = randomBytes(32);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(claim) });
  const token = tokenParam(w.mails[0].text);
  await w.call('GET', `/v1/lost/confirm?t=${token}`);
  await w.call('GET', `/v1/lost/cancel?t=${token}`);
  w.setClock(NOW + DAY);
  const r = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(claim) });
  assert.deepEqual(r, { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('status shows the pending request to a signed-in device and nothing to a stranger (401)', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);

  assert.equal((await w.call('GET', '/v1/lost/status')).status, 401);
  const r = await w.call('GET', '/v1/lost/status', LOGIN);
  assert.deepEqual(r, { status: 200, body: { escrow: true, pending: { releaseAt: NOW + DAY } } });
});

test('DELETE /v1/escrow needs the login role', async () => {
  const w = world();
  await setUp(w);
  const newRecovery = await enroll(w);
  assert.equal((await w.call('DELETE', '/v1/escrow', newRecovery)).status, 401);
  assert.ok(w.escrowRow());
  const r = await w.call('DELETE', '/v1/escrow', LOGIN);
  assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(w.escrowRow(), undefined);
});

test('re-enrolling escrow with a rotated recoveryHash invalidates an old confirmed lost_request', async () => {
  const w = world();
  await setUp(w);
  const recoveryA = await enroll(w, 'owner@example.com', 'blob-A');
  const oldClaim = randomBytes(32);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(oldClaim) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  assert.equal(w.lostRow()?.releaseAt, NOW + DAY);

  const recoveryB = tok(30);
  const reEnrol = await w.call('PUT', '/v1/account', recoveryA, {
    ...account({ recoveryHash: tokenHash(recoveryB) }),
    ifRev: 2,
    escrow: { email: 'owner@example.com', blob: btoa('blob-B'), code: 'NEW-CODE' },
  });
  assert.equal(reEnrol.status, 200);
  assert.deepEqual(w.escrowRow(), { email: 'owner@example.com', blob: btoa('blob-B') });
  assert.equal(w.lostRow(), undefined);

  w.setClock(NOW + DAY);
  const release = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(oldClaim) });
  assert.deepEqual(release, { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('a stranger cannot overwrite a confirmed, non-cancelled lost_request', async () => {
  const w = world();
  await setUp(w);
  await enroll(w, 'owner@example.com', 'the-real-blob');
  const ownerClaim = randomBytes(32);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(ownerClaim) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  const confirmedRow = w.lostRow();
  assert.equal(confirmedRow?.releaseAt, NOW + DAY);
  const mailsAfterConfirm = w.mails.length;

  w.setClock(NOW + HOUR + 1000);
  const attempt = await w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) });
  assert.deepEqual(attempt, { status: 200, body: { ok: true } });
  assert.deepEqual(w.lostRow(), confirmedRow);
  assert.equal(w.mails.length, mailsAfterConfirm);

  w.setClock(NOW + DAY);
  const release = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(ownerClaim) });
  assert.deepEqual(release, { status: 200, body: { state: 'ready', blob: btoa('the-real-blob') } });
});

test('parallel requests claim the rate-limit slot atomically; only one mail is sent', async () => {
  const w = world();
  await setUp(w);
  await enroll(w);
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () => w.call('POST', '/v1/lost/request', undefined, { claimHash: toBase64(randomBytes(32)) })),
  );
  for (const r of attempts) assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(w.mails.length, 1);
});

test('a claim shorter than 32 bytes (Task 15 length) still releases', async () => {
  const w = world();
  await setUp(w);
  await enroll(w, 'owner@example.com', 'short-claim-blob');
  const claim = randomBytes(20);
  await w.call('POST', '/v1/lost/request', undefined, { claimHash: tokenHash(claim) });
  await w.call('GET', `/v1/lost/confirm?t=${tokenParam(w.mails[0].text)}`);
  w.setClock(NOW + DAY);
  const r = await w.call('POST', '/v1/lost/release', undefined, { claim: toBase64(claim) });
  assert.deepEqual(r, { status: 200, body: { state: 'ready', blob: btoa('short-claim-blob') } });
});
