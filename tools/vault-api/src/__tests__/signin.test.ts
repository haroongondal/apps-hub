import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'strongroom-core/src/crypto.ts';
import { toBase64, tokenHash } from 'strongroom-core/src/format.ts';
import { handle, type Env, type Mailer } from '../index.ts';
import { deviceLabel } from '../signin.ts';
import { d1FromNodeSqlite } from './d1-fake.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const SETUP = 'setup-token-for-tests-0123456789abcdef';
const HEADER = JSON.stringify({ version: 1, kdf: { memoryKiB: 65536, iterations: 3, parallelism: 1 }, salt: 'AAECAwQFBgcICQoLDA0ODw==', passwordWrap: 'cA==', recoveryWrap: 'cg==', accountKey: true });
const tok = (n: number) => new Uint8Array(32).fill(n);
const LOGIN = tok(1);
const READ = tok(3);
const CODE = 'EMAILCODE-0123456789';
const ESCROW_BLOB = btoa('escrow: recovery key and account key');
const SIGNIN_BLOB = btoa('signin: account key only');
const migrations = ['0001_init.sql', '0002_escrow.sql', '0003_signin.sql'].map((f) => readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));

type Body = Record<string, any>;
const account = (over: object = {}) => ({ header: HEADER, loginHash: tokenHash(LOGIN), recoveryHash: tokenHash(tok(2)), readHash: tokenHash(READ), ...over });
const linkToken = (text: string, path: string) => decodeURIComponent(new RegExp(`${path.replace(/\//g, '\\/')}\\?t=([^&\\s]+)`).exec(text)![1]);

function world(wait?: string | number) {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of migrations) sqlite.exec(m);
  const mails: { to: string; subject: string; text: string }[] = [];
  let clock = NOW;
  const mail: Mailer = { send: async (to, subject, text) => void mails.push({ to, subject, text }) };
  const env: Env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: SETUP, PUBLIC_URL: 'https://vault.example', SIGNIN_WAIT_HOURS: wait };
  const deps = { now: () => clock, sleep: async () => {}, mail };
  const read = async (res: Response) => ({ status: res.status, body: ((res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()) as Body });
  const call = (method: string, path: string, auth?: Uint8Array | string, body?: unknown) => {
    const headers: Record<string, string> = auth === undefined ? {} : { authorization: `Bearer ${typeof auth === 'string' ? auth : toBase64(auth)}` };
    return handle(new Request(`https://vault.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps).then(read);
  };
  const postForm = (path: string, t: string) =>
    handle(new Request(`https://vault.example${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${encodeURIComponent(t)}` }), env, deps).then(read);
  const rows = (table: string) => sqlite.prepare(`SELECT * FROM ${table}`).all().map((r) => ({ ...(r as object) }) as Body);
  const request = (claim: Uint8Array, deviceName: unknown = 'Work laptop') => call('POST', '/v1/signin/request', undefined, { claimHash: tokenHash(claim), deviceName });
  const release = (claim: Uint8Array) => call('POST', '/v1/signin/release', undefined, { claim: toBase64(claim) });
  return { sqlite, mails, call, postForm, rows, request, release, setClock: (ms: number) => void (clock = ms) };
}
type World = ReturnType<typeof world>;

async function setUp(w: World) {
  assert.deepEqual(await w.call('PUT', '/v1/account', SETUP, account()), { status: 200, body: { headerRev: 1 } });
}

// Turns on email recovery and email sign-in the way a client does: rotate the recovery key, send both blobs and the code.
async function enrol(w: World, rev = 1, recovery = tok(20), blob = SIGNIN_BLOB) {
  const r = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(recovery) }), ifRev: rev, escrow: { email: 'owner@example.com', blob: ESCROW_BLOB, code: CODE }, signin: { blob } });
  assert.equal(r.status, 200);
  w.mails.length = 0;
}

async function requested(w: World, claim = randomBytes(32)) {
  assert.deepEqual(await w.request(claim), { status: 200, body: { ok: true } });
  const mail = w.mails.at(-1)!;
  return { claim, approve: linkToken(mail.text, '/v1/signin/approve'), deny: linkToken(mail.text, '/v1/signin/deny'), mail };
}

test('enrolling stores the sign-in blob apart from the escrow, and the code nowhere', async () => {
  const w = world();
  await setUp(w);
  const r = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(tok(20)) }), ifRev: 1, escrow: { email: 'owner@example.com', blob: ESCROW_BLOB, code: CODE }, signin: { blob: SIGNIN_BLOB } });
  assert.equal(r.status, 200);
  assert.deepEqual(w.rows('signin').map(({ blob }) => blob), [SIGNIN_BLOB]);
  assert.deepEqual(w.rows('escrow').map(({ blob }) => blob), [ESCROW_BLOB]);
  assert.equal(w.mails.length, 1);
  assert.match(w.mails[0].text, new RegExp(CODE));
  assert.match(w.mails[0].text, /sign in on a new device/);
  const everything = JSON.stringify(['account', 'escrow', 'signin', 'signin_request', 'lost_request'].map((t) => w.rows(t)));
  assert.ok(!everything.includes(CODE));
});

test('setup can carry the sign-in blob too', async () => {
  const w = world();
  const r = await w.call('PUT', '/v1/account', SETUP, { ...account(), escrow: { email: 'owner@example.com', blob: ESCROW_BLOB, code: CODE }, signin: { blob: SIGNIN_BLOB } });
  assert.deepEqual(r, { status: 200, body: { headerRev: 1 } });
  assert.deepEqual(w.rows('signin').map(({ blob }) => blob), [SIGNIN_BLOB]);
});

test('a sign-in blob that is not base64, or comes without escrow, is refused before any mail or write', async () => {
  const w = world();
  await setUp(w);
  const escrow = { email: 'owner@example.com', blob: ESCROW_BLOB, code: CODE };
  for (const body of [
    { escrow, signin: { blob: 'not base64!' } },
    { escrow, signin: { blob: '' } },
    { escrow, signin: null },
    { escrow, signin: {} },
    { signin: { blob: SIGNIN_BLOB } },
  ]) {
    const r = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(tok(20)) }), ifRev: 1, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(w.mails.length, 0);
  assert.deepEqual([w.rows('signin'), w.rows('escrow')], [[], []]);
});

test('a PUT without signin keeps the blob; a new recovery key without one clears it and ends the request', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  await requested(w);
  const { recoveryHash: _, ...passwordChange } = account({ loginHash: tokenHash(tok(4)) });
  assert.equal((await w.call('PUT', '/v1/account', LOGIN, { ...passwordChange, ifRev: 2 })).status, 200);
  assert.equal(w.rows('signin').length, 1);
  assert.equal(w.rows('signin_request').length, 1);

  assert.equal((await w.call('PUT', '/v1/account', tok(4), { ...account({ loginHash: tokenHash(tok(4)), recoveryHash: tokenHash(tok(30)) }), ifRev: 3 })).status, 200);
  assert.deepEqual([w.rows('signin'), w.rows('signin_request'), w.rows('escrow')], [[], [], []]);
});

test('re-enrolling replaces the blob and ends a request approved under the old one', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { claim, approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  await enrol(w, 2, tok(21), btoa('signin: new code'));
  assert.deepEqual(w.rows('signin').map(({ blob }) => blob), [btoa('signin: new code')]);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt: null } });

  const again = await requested(w);
  await w.postForm('/v1/signin/approve', again.approve);
  await enrol(w, 3, tok(21), btoa('signin: same recovery key, newer code'));
  assert.deepEqual(await w.release(again.claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('DELETE /v1/escrow also clears the sign-in blob and its request', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  await requested(w);
  assert.deepEqual(await w.call('DELETE', '/v1/escrow', LOGIN), { status: 200, body: { ok: true } });
  assert.deepEqual([w.rows('signin'), w.rows('signin_request')], [[], []]);
});

test('a stale PUT that loses the rev race leaves the sign-in blob and request untouched', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  await requested(w);
  const before = [w.rows('signin'), w.rows('signin_request')];
  const stale = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(tok(50)) }), ifRev: 1, escrow: { email: 'x@example.com', blob: ESCROW_BLOB, code: 'X' }, signin: { blob: btoa('stale') } });
  assert.equal(stale.status, 409);
  assert.deepEqual([w.rows('signin'), w.rows('signin_request')], before);
});

test('a request with no sign-in blob answers ok but mails nothing and stores nothing', async () => {
  const w = world();
  await setUp(w);
  assert.deepEqual(await w.request(randomBytes(32)), { status: 200, body: { ok: true } });
  const escrowOnly = await w.call('PUT', '/v1/account', LOGIN, { ...account({ recoveryHash: tokenHash(tok(20)) }), ifRev: 1, escrow: { email: 'owner@example.com', blob: ESCROW_BLOB, code: CODE } });
  assert.equal(escrowOnly.status, 200);
  w.mails.length = 0;
  assert.deepEqual(await w.request(randomBytes(32)), { status: 200, body: { ok: true } });
  assert.deepEqual(w.mails, []);
  assert.deepEqual(w.rows('signin_request'), []);
});

test('a request mails the owner the device, the time and both links, and never the blob or the code', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const claim = randomBytes(32);
  const { mail } = await requested(w, claim);
  assert.equal(w.mails.length, 1);
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.text, /Work laptop/);
  assert.ok(mail.text.includes(new Date(NOW).toUTCString()));
  assert.match(mail.text, /approve it: https:\/\/vault\.example\/v1\/signin\/approve\?t=/);
  assert.match(mail.text, /Wasn't you\? Deny it: https:\/\/vault\.example\/v1\/signin\/deny\?t=/);
  for (const secret of [SIGNIN_BLOB, ESCROW_BLOB, CODE, atob(SIGNIN_BLOB)]) assert.ok(!(mail.subject + mail.text).includes(secret), secret);
  assert.deepEqual(
    w.rows('signin_request').map(({ claim_hash, requested_at, approved_at, cancelled }) => ({ claim_hash, requested_at, approved_at, cancelled })),
    [{ claim_hash: tokenHash(claim), requested_at: NOW, approved_at: null, cancelled: 0 }],
  );
});

test('the device name is cut to 60 characters of plain words, so it cannot carry a link or extra lines', async () => {
  assert.equal(deviceLabel('Chrome on Mac\n\nApprove here: https://evil.example/x?t=1'), 'Chrome on Mac Approve here https evil example x t 1');
  assert.equal(deviceLabel('owner@evil.example'), 'owner evil example');
  assert.equal(deviceLabel('\u202Egnp.exe'), 'gnp exe');
  assert.equal(deviceLabel('لیپ ٹاپ (دفتر)'), 'لیپ ٹاپ (دفتر)');
  assert.equal(Array.from(deviceLabel('x'.repeat(200))).length, 60);
  assert.equal(deviceLabel(' '.repeat(5_000_000) + 'hidden'), 'Unnamed device');
  for (const empty of ['', '...', 42, null, undefined]) assert.equal(deviceLabel(empty), 'Unnamed device');

  const w = world();
  await setUp(w);
  await enrol(w);
  await w.request(randomBytes(32), 'Laptop\nIf this was you, approve it: https://evil.example');
  assert.match(w.mails[0].text, /^Device \(the name it gave itself\): Laptop If this was you approve it https evil example$/m);
  assert.equal(w.mails[0].text.match(/https:\/\//g)?.length, 2);
});

test('one row per claim: a stranger cannot replace the owner request; at most 5 in an hour, then old ones expire', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const owner = await requested(w);
  for (let i = 0; i < 4; i++) await requested(w);
  w.setClock(NOW + HOUR - 1000);
  assert.deepEqual(await w.request(randomBytes(32)), { status: 200, body: { ok: true } });
  assert.equal(w.mails.length, 5);
  assert.equal(w.rows('signin_request').length, 5);
  assert.equal(String((await w.postForm('/v1/signin/approve', owner.approve)).body).includes('no longer valid'), false);
  assert.deepEqual(await w.release(owner.claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });

  w.setClock(NOW + HOUR);
  const later = await requested(w);
  assert.equal(w.mails.length, 6);
  assert.deepEqual(await w.release(owner.claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });
  w.setClock(NOW + 2 * HOUR);
  assert.match(String((await w.postForm('/v1/signin/approve', later.approve)).body), /no longer valid/);
  assert.deepEqual(await w.release(owner.claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('the same claim twice is one request and one mail', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { claim } = await requested(w);
  await w.request(claim);
  assert.equal(w.mails.length, 1);
  assert.equal(w.rows('signin_request').length, 1);
});

test('parallel requests never pass the cap of 5; one mail per stored request', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const all = await Promise.all(Array.from({ length: 10 }, () => w.request(randomBytes(32))));
  for (const r of all) assert.deepEqual(r, { status: 200, body: { ok: true } });
  assert.equal(w.mails.length, 5);
  assert.equal(w.rows('signin_request').length, 5);
});

test('the GET links only render a form; nothing changes until the form is posted, and a bad token is never rendered', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { approve, deny } = await requested(w);
  const before = w.rows('signin_request');
  const approvePage = await w.call('GET', `/v1/signin/approve?t=${encodeURIComponent(approve)}`);
  assert.match(String(approvePage.body), /<form method="post" action="\/v1\/signin\/approve">/);
  assert.ok(String(approvePage.body).includes(`value="${approve}"`));
  const denyPage = await w.call('GET', `/v1/signin/deny?t=${encodeURIComponent(deny)}`);
  assert.match(String(denyPage.body), /<form method="post" action="\/v1\/signin\/deny">/);
  assert.deepEqual(w.rows('signin_request'), before);
  assert.equal(w.mails.length, 1);

  const evil = await w.call('GET', '/v1/signin/approve?t=<script>alert(1)</script>');
  assert.doesNotMatch(String(evil.body), /<script>/);
  assert.match(String(evil.body), /no longer valid/);
});

test('wait off: release waits with no time until approved, then hands out the sign-in blob at once', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { claim, approve } = await requested(w);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt: null } });

  w.setClock(NOW + 5000);
  assert.match(String((await w.postForm('/v1/signin/approve', approve)).body), /can sign in now/);
  assert.equal(w.rows('signin_request')[0].approved_at, NOW + 5000);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });
});

test('wait 24: the mail says so, and release refuses until 24 hours after approval', async () => {
  const w = world('24');
  await setUp(w);
  await enrol(w);
  const { claim, approve, mail } = await requested(w);
  assert.match(mail.text, /24 hours later/);
  w.setClock(NOW + 1000);
  assert.ok(String((await w.postForm('/v1/signin/approve', approve)).body).includes(new Date(NOW + 1000 + 24 * HOUR).toUTCString()));
  const releaseAt = NOW + 1000 + 24 * HOUR;
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt } });
  w.setClock(releaseAt - 1);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt } });
  w.setClock(releaseAt);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });
});

test('the wait also takes a number, and a value that is not 0 or more hours fails closed with nothing stored or mailed', async () => {
  const w = world(24);
  await setUp(w);
  await enrol(w);
  const { claim, approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  assert.equal((await w.release(claim)).body.state, 'waiting');

  for (const bad of ['24h', '-1', 'off']) {
    const b = world(bad);
    await setUp(b);
    await enrol(b);
    assert.equal((await b.request(randomBytes(32))).status, 500);
    assert.equal((await b.release(randomBytes(32))).status, 500);
    assert.deepEqual([b.mails, b.rows('signin_request')], [[], []]);
  }
});

test('a second approve says it is already approved and does not move the approval time', async () => {
  const w = world('24');
  await setUp(w);
  await enrol(w);
  const { approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  w.setClock(NOW + HOUR);
  assert.match(String((await w.postForm('/v1/signin/approve', approve)).body), /already approved/);
  assert.equal(w.rows('signin_request')[0].approved_at, NOW);
});

test('deny by the mailed link stops the request, even after approval, and the deny token cannot approve', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { claim, approve, deny } = await requested(w);
  assert.match(String((await w.postForm('/v1/signin/approve', deny)).body), /no longer valid/);
  assert.equal(w.rows('signin_request')[0].approved_at, null);

  await w.postForm('/v1/signin/approve', approve);
  await w.postForm('/v1/signin/deny', approve);
  assert.equal(w.rows('signin_request')[0].cancelled, 0);
  assert.match(String((await w.postForm('/v1/signin/deny', deny)).body), /Denied/);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
  assert.match(String((await w.postForm('/v1/signin/approve', approve)).body), /no longer valid/);
});

test('a denied request ends at once, and the next request gets its own row', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const first = await requested(w);
  await w.postForm('/v1/signin/deny', first.deny);
  const next = await requested(w);
  assert.equal(w.mails.length, 2);
  assert.match(String((await w.postForm('/v1/signin/approve', first.approve)).body), /no longer valid/);
  await w.postForm('/v1/signin/approve', next.approve);
  assert.deepEqual(await w.release(next.claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });
  assert.deepEqual(await w.release(first.claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('a signed-in device cancels by Bearer token (the read token is enough); a stranger gets 401', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  const { claim, approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  assert.equal((await w.call('POST', '/v1/signin/cancel')).status, 401);
  assert.equal((await w.call('POST', '/v1/signin/cancel', tok(77))).status, 401);
  assert.equal(w.rows('signin_request')[0].cancelled, 0);
  assert.deepEqual(await w.call('POST', '/v1/signin/cancel', READ), { status: 200, body: { ok: true } });
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('a wrong or malformed claim looks the same as no request', async () => {
  const w = world();
  const none = await w.release(randomBytes(32));
  assert.deepEqual(none, { status: 200, body: { state: 'waiting', releaseAt: null } });
  await setUp(w);
  await enrol(w);
  const { approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  assert.deepEqual(await w.release(randomBytes(32)), none);
  for (const claim of ['', 'short', '!'.repeat(44), 42]) assert.deepEqual(await w.call('POST', '/v1/signin/release', undefined, { claim }), none);
  assert.deepEqual(await w.call('POST', '/v1/signin/release', undefined, undefined), none);
});

test('an approved request still counts toward the cap and is ready until an hour after its release time', async () => {
  const w = world('24');
  await setUp(w);
  await enrol(w);
  const { claim, approve } = await requested(w);
  await w.postForm('/v1/signin/approve', approve);
  const releaseAt = NOW + 24 * HOUR;
  w.setClock(releaseAt + HOUR - 1000);
  for (let i = 0; i < 5; i++) await w.request(randomBytes(32));
  assert.equal(w.mails.length, 5);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'ready', blob: SIGNIN_BLOB } });
  w.setClock(releaseAt + HOUR);
  assert.deepEqual(await w.release(claim), { status: 200, body: { state: 'waiting', releaseAt: null } });
});

test('the sign-in routes never touch the failed-login counter', async () => {
  const w = world();
  await setUp(w);
  await enrol(w);
  w.sqlite.exec('UPDATE auth_state SET failures = 3');
  const { claim, approve, deny } = await requested(w);
  await w.call('GET', `/v1/signin/approve?t=${encodeURIComponent(approve)}`);
  await w.postForm('/v1/signin/approve', toBase64(randomBytes(32)));
  await w.postForm('/v1/signin/approve', approve);
  await w.release(claim);
  await w.release(randomBytes(32));
  await w.postForm('/v1/signin/deny', deny);
  assert.deepEqual(w.rows('auth_state'), [{ id: 1, failures: 3 }]);
});
