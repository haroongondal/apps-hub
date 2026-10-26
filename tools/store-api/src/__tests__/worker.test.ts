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
