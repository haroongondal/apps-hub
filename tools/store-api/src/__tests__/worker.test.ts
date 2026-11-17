import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, SIGNED_URL_TTL_S, type Bucket, type Env } from '../index.ts';

type Stored = { bytes: ArrayBuffer; type?: string };

function fakeBucket(): Bucket & { data: Map<string, Stored> } {
  const data = new Map<string, Stored>();
  return {
    data,
    async get(key: string) {
      const o = data.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength, httpMetadata: { contentType: o.type } } : null;
    },
    async put(key: string, value: ReadableStream, options?: { httpMetadata?: { contentType?: string } }) {
      data.set(key, { bytes: await new Response(value).arrayBuffer(), type: options?.httpMetadata?.contentType });
    },
  };
}

const STORE = 's'.repeat(40);
const RELEASE = 'r'.repeat(40);
const env = (): Env & { BUCKET: ReturnType<typeof fakeBucket> } => ({
  BUCKET: fakeBucket(),
  STORE_TOKEN: STORE,
  RELEASE_TOKEN: RELEASE,
  SIGNING_KEY: 'k'.repeat(40),
});
const req = (method: string, path: string, token?: string, body?: BodyInit) =>
  new Request(`https://store.example${path}`, {
    method,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

test('upload needs the release token; store token is rejected', async () => {
  const e = env();
  assert.equal((await handle(req('PUT', '/admin/manifest.json', STORE, '{}'), e)).status, 401);
  assert.equal((await handle(req('PUT', '/admin/manifest.json', RELEASE, '{"a":1}'), e)).status, 204);
  assert.equal((await handle(req('PUT', '/admin/../x', RELEASE, 'x'), e)).status, 404);
});

test('manifest is readable with either token, not without', async () => {
  const e = env();
  await handle(req('PUT', '/admin/manifest.json', RELEASE, '{"a":1}'), e);
  assert.equal((await handle(req('GET', '/manifest.json'), e)).status, 401);
  assert.equal((await handle(req('GET', '/manifest.json', 'wrong'), e)).status, 401);
  const res = await handle(req('GET', '/manifest.json', STORE), e);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { a: 1 });
});

test('signed URL downloads until it expires and rejects tampering', async () => {
  const e = env();
  await handle(req('PUT', '/admin/apps/netlens/android/2.apk', RELEASE, 'APK'), e);
  const now = 1_800_000_000_000;
  const signed = await handle(req('POST', '/sign', STORE, JSON.stringify({ path: 'apps/netlens/android/2.apk' })), e, now);
  const { url } = (await signed.json()) as { url: string };
  const path = new URL(url).pathname + new URL(url).search;

  const ok = await handle(req('GET', path), e, now + 1000);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'APK');
  assert.equal((await handle(req('GET', path), e, now + SIGNED_URL_TTL_S * 1000 + 1)).status, 403);
  assert.equal((await handle(req('GET', path.replace('2.apk', '3.apk')), e, now)).status, 403);
});

test('sign refuses paths outside apps/ and unauthenticated callers', async () => {
  const e = env();
  assert.equal((await handle(req('POST', '/sign', STORE, JSON.stringify({ path: 'manifest.json' })), e)).status, 400);
  assert.equal((await handle(req('POST', '/sign', undefined, JSON.stringify({ path: 'apps/x' })), e)).status, 401);
});

test('short or missing tokens never authorize', async () => {
  const e = { ...env(), STORE_TOKEN: '' };
  assert.equal((await handle(req('GET', '/manifest.json', ''), e)).status, 401);
});

const SHA = 'ab'.repeat(32);

test('models route serves a stored model without any token', async () => {
  const e = env();
  await handle(req('PUT', `/admin/models/${SHA}`, RELEASE, 'ONNX'), e);
  const res = await handle(req('GET', `/models/${SHA}`), e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '4');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await res.text(), 'ONNX');
  // a public read must not depend on signing config
  assert.equal((await handle(req('GET', `/models/${SHA}`), { ...e, SIGNING_KEY: '' })).status, 200);
});

test('models route 404s for a missing model', async () => {
  assert.equal((await handle(req('GET', `/models/${SHA}`), env())).status, 404);
});

test('models route refuses anything but 64 lowercase hex', async () => {
  const e = env();
  const asked: string[] = [];
  const get = e.BUCKET.get.bind(e.BUCKET);
  e.BUCKET.get = (key: string) => (asked.push(key), get(key));
  for (const k of ['apps/netlens/android/2.apk', 'manifest.json', `models/${SHA}`]) {
    await e.BUCKET.put(k, new Blob(['SECRET']).stream());
  }
  asked.length = 0;
  const bad = [
    `/models/${SHA.toUpperCase()}`,
    `/models/${SHA.slice(1)}`,
    `/models/${SHA}0`,
    `/models/${SHA}/x`,
    `/models/${SHA}/`,
    `/models/${SHA}.onnx`,
    `/models/${SHA}%00`,
    `/models/%61${SHA.slice(1)}`,
    `/models/${SHA}%2F..%2Fmanifest.json`,
    `/models/..%2Fapps%2Fnetlens%2Fandroid%2F2.apk`,
    `/models/../manifest.json`,
    `/models/%2e%2e/manifest.json`,
    `/models//${SHA}`,
    `//models/${SHA}`,
    `/Models/${SHA}`,
    `/models/`,
    `/models`,
    `/models/apps/netlens/android/2.apk`,
  ];
  for (const p of bad) assert.notEqual((await handle(req('GET', p), e)).status, 200, p);
  // a query string is not part of the key
  assert.equal((await handle(req('GET', `/models/${SHA}?x=../manifest.json`), e)).status, 200);
  assert.deepEqual([...new Set(asked)], [`models/${SHA}`]);
});

test('models route is GET only and never writes', async () => {
  const e = env();
  const before = new Map(e.BUCKET.data);
  for (const m of ['PUT', 'POST', 'DELETE', 'PATCH']) {
    const res = await handle(req(m, `/models/${SHA}`, undefined, 'X'), e);
    assert.ok([401, 404].includes(res.status), `${m} ${res.status}`);
    assert.equal((await handle(req(m, `/models/${SHA}`, RELEASE, 'X'), e)).status, 404, m);
  }
  assert.deepEqual(e.BUCKET.data, before);
});

test('apps keys stay private', async () => {
  const e = env();
  await handle(req('PUT', '/admin/apps/netlens/android/2.apk', RELEASE, 'APK'), e);
  for (const p of ['/models/apps/netlens/android/2.apk', '/models/../apps/netlens/android/2.apk', '/apps/netlens/android/2.apk']) {
    assert.equal((await handle(req('GET', p), e)).status, 404, p);
  }
  assert.equal((await handle(req('GET', '/manifest.json'), e)).status, 401);
});
