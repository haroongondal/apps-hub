import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUploader, type Send } from '../upload.ts';

function fakeStore() {
  const calls: string[] = [];
  const parts = new Map<number, Uint8Array>();
  const done: Uint8Array[] = [];
  const send: Send = async (method, input, headers, body) => {
    const url = new URL(input);
    calls.push(`${method} ${url.pathname}${url.search}`);
    assert.equal(headers.authorization, 'Bearer tok');
    if (url.searchParams.has('uploads')) return { status: 200, text: JSON.stringify({ uploadId: 'u1' }) };
    if (url.searchParams.has('part')) {
      const n = Number(url.searchParams.get('part'));
      parts.set(n, body);
      return { status: 200, text: JSON.stringify({ partNumber: n, etag: `e${n}` }) };
    }
    if (url.searchParams.has('uploadId')) {
      const { parts: list } = JSON.parse(body.toString()) as { parts: { partNumber: number }[] };
      for (const p of list) done.push(parts.get(p.partNumber)!);
      return { status: 204, text: '' };
    }
    done.push(body);
    return { status: 204, text: '' };
  };
  return { calls, done, send };
}

test('a file within one part is a single PUT', async () => {
  const s = fakeStore();
  await makeUploader('https://s.example', 'tok', s.send, 8)('manifest.json', 'tiny', 'application/json');
  assert.deepEqual(s.calls, ['PUT /admin/manifest.json']);
});

test('a bigger file goes up in equal parts and arrives whole', async () => {
  const s = fakeStore();
  const data = Buffer.from('0123456789ABCDEFGHIJ'); // 20 bytes, 8-byte parts: 8 + 8 + 4
  await makeUploader('https://s.example', 'tok', s.send, 8)('apps/x/android/1.apk', data, 'application/octet-stream');
  assert.deepEqual(s.calls, [
    'POST /admin/apps/x/android/1.apk?uploads',
    'PUT /admin/apps/x/android/1.apk?uploadId=u1&part=1',
    'PUT /admin/apps/x/android/1.apk?uploadId=u1&part=2',
    'PUT /admin/apps/x/android/1.apk?uploadId=u1&part=3',
    'POST /admin/apps/x/android/1.apk?uploadId=u1',
  ]);
  assert.equal(Buffer.concat(s.done).toString(), data.toString());
  assert.deepEqual(s.done.map((p) => p.length), [8, 8, 4]);
});

test('a refused request says which one', async () => {
  const send: Send = async () => ({ status: 413, text: 'nope' });
  await assert.rejects(makeUploader('https://s.example', 'tok', send, 8)('k.apk', 'x', 'a/b'), /PUT k\.apk: 413 nope/);
});
