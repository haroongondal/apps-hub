import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { fetchTransport, SyncAuthError, SyncHttpError, SyncOfflineError } from '../sync/transport.ts';

type Sent = { url: string; method: string; auth: string | null; body: unknown };

function fakeFetch(reply: (s: Sent) => { status: number; body?: unknown }) {
  const sent: Sent[] = [];
  const fn = async (...[input, init]: Parameters<typeof fetch>): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const s = { url: String(input), method: init?.method ?? 'GET', auth: headers.get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    sent.push(s);
    const r = reply(s);
    return new Response(r.body === undefined ? 'not json' : JSON.stringify(r.body), { status: r.status });
  };
  return { sent, fn };
}

const TOKEN = new Uint8Array(32).fill(1);
const BEARER = `Bearer ${btoa(String.fromCharCode(...TOKEN))}`;
const PAGE = { header: '{}', headerRev: 1, records: [], latestRev: 0, more: false };
const ACCOUNT = { header: '{}', loginHash: 'l', recoveryHash: 'r', readHash: 'd' };

test('fetchTransportSpeaksTheProtocol', async () => {
  const f = fakeFetch((s) => (s.url.endsWith('/v1/prelogin') ? { status: 404, body: { error: 'none' } } : s.method === 'POST' ? { status: 409, body: { conflicts: [{ id: 'a', rev: 4 }] } } : { status: 200, body: s.method === 'PUT' ? { headerRev: 2 } : PAGE }));
  const t = fetchTransport('https://vault.example/', f.fn);
  assert.equal(await t.prelogin(), null);
  assert.deepEqual(await t.pull(TOKEN, 7), PAGE);
  assert.deepEqual(await t.push(TOKEN, { upserts: [{ id: 'a', baseRev: 0, ciphertext: 'AA==' }] }), { conflicts: [{ id: 'a', rev: 4 }] });
  assert.deepEqual(await t.putAccount({ setupToken: 's'.repeat(32) }, ACCOUNT), { headerRev: 2 });
  assert.deepEqual(await t.putAccount(TOKEN, { ...ACCOUNT, ifRev: 1 }), { headerRev: 2 });
  assert.deepEqual(f.sent, [
    { url: 'https://vault.example/v1/prelogin', method: 'GET', auth: null, body: undefined },
    { url: 'https://vault.example/v1/records?since=7', method: 'GET', auth: BEARER, body: undefined },
    { url: 'https://vault.example/v1/records', method: 'POST', auth: BEARER, body: { upserts: [{ id: 'a', baseRev: 0, ciphertext: 'AA==' }] } },
    { url: 'https://vault.example/v1/account', method: 'PUT', auth: `Bearer ${'s'.repeat(32)}`, body: ACCOUNT },
    { url: 'https://vault.example/v1/account', method: 'PUT', auth: BEARER, body: { ...ACCOUNT, ifRev: 1 } },
  ]);
});

test('fetchTransportMapsFailures', async () => {
  const status = (n: number, body?: unknown) => fetchTransport('https://vault.example', fakeFetch(() => ({ status: n, body })).fn);
  await assert.rejects(status(401, { error: 'no' }).pull(TOKEN, 0), SyncAuthError);
  await assert.rejects(status(401).push(TOKEN, { upserts: [] }), SyncAuthError);
  await assert.rejects(status(500, { error: 'boom' }).pull(TOKEN, 0), (e: unknown) => e instanceof SyncHttpError && e.status === 500);
  await assert.rejects(status(413, { error: 'big' }).push(TOKEN, { upserts: [] }), (e: unknown) => e instanceof SyncHttpError && e.status === 413);
  await assert.rejects(status(200).pull(TOKEN, 0), (e: unknown) => e instanceof SyncHttpError && e.status === 200);
  const down = fetchTransport('https://vault.example', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(down.prelogin(), SyncOfflineError);
});

test('malformedServerBodiesAreRefused', async () => {
  const with_ = (status: number, body: unknown) => fetchTransport('https://vault.example', fakeFetch(() => ({ status, body })).fn);
  const refused = (status: number) => (e: unknown) => e instanceof SyncHttpError && !(e instanceof SyncAuthError) && e.status === status;
  for (const body of [null, [], {}, { ...PAGE, records: 'none' }, { ...PAGE, records: [null] }, { ...PAGE, more: 1 }, { ...PAGE, header: 3 }]) {
    await assert.rejects(with_(200, body).pull(TOKEN, 0), refused(200), JSON.stringify(body));
  }
  for (const body of [{ latestRev: 1 }, { revs: [null], latestRev: 1 }, { revs: [], latestRev: '1' }]) {
    await assert.rejects(with_(200, body).push(TOKEN, { upserts: [] }), refused(200), JSON.stringify(body));
  }
  for (const body of [{ error: 'stale' }, { conflicts: 'x' }]) {
    await assert.rejects(with_(409, body).push(TOKEN, { upserts: [] }), refused(409), JSON.stringify(body));
  }
  await assert.rejects(with_(200, { kdf: null, salt: 's', accountKey: true }).prelogin(), refused(200));
  await assert.rejects(with_(200, { version: 1, kdf: {}, salt: 's' }).prelogin(), refused(200));
  const pre = { version: 1, kdf: { memoryKiB: 65536, iterations: 3, parallelism: 1 }, salt: 'AAECAwQFBgcICQoLDA0ODw==', accountKey: true };
  assert.deepEqual(await with_(200, pre).prelogin(), pre);
  for (const salt of ['not*base64*salt*here*!==', 'AAECAwQFBgc=', 'AAECAwQFBgcICQoLDA0ODw', 'AAECAwQFBgcICQoLDA0ODxAR', [pre.salt]]) {
    await assert.rejects(with_(200, { ...pre, salt }).prelogin(), refused(200), JSON.stringify(salt));
  }
  await assert.rejects(with_(200, { headerRev: '2' }).putAccount({ setupToken: 's' }, ACCOUNT), refused(200));
});

test('fetchTransportGivesUpAfter30Seconds', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const hang = (...[, init]: Parameters<typeof fetch>) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const pending = fetchTransport('https://vault.example', hang).pull(TOKEN, 0);
    mock.timers.tick(29_999);
    let settled = false;
    pending.catch(() => {}).finally(() => (settled = true));
    await Promise.resolve();
    assert.equal(settled, false);
    mock.timers.tick(1);
    await assert.rejects(pending, SyncOfflineError);
  } finally {
    mock.timers.reset();
  }
});
