import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createImagePicker, type ImagePickDeps } from '../editor/image-pick.ts';
import { PIECE_BYTES } from '../editor/vision-host.ts';

const root = new URL('../../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

function bytesOf(n: number) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255;
  return b;
}

function fake(files: Record<string, Buffer>, opts: { cancel?: boolean; sizeFails?: boolean; hold?: Promise<void> } = {}) {
  const store = new Map(Object.entries(files));
  const removed: string[] = [];
  const deps: ImagePickDeps = {
    async pick() {
      await opts.hold;
      return opts.cancel ? null : [...store.keys()].map(uri => ({ uri, name: uri.split('/').pop()!, mimeType: 'image/jpeg' }));
    },
    async size(uri) {
      if (opts.sizeFails) throw new Error('gone');
      return store.get(uri)!.length;
    },
    async readBase64(uri, position, length) {
      return store.get(uri)!.subarray(position, position + length).toString('base64');
    },
    async remove(uri) { removed.push(uri); store.delete(uri); },
  };
  return { picker: createImagePicker(deps), removed, store };
}

async function download(picker: ReturnType<typeof createImagePicker>, uri: string) {
  const parts: Buffer[] = [];
  for (let index = 0; ; index++) {
    const { data, done } = await picker.read(uri, index);
    assert.ok(data.length <= 1_048_576, 'a piece is at most 1 MB of base64');
    parts.push(Buffer.from(data, 'base64'));
    if (done) return Buffer.concat(parts);
  }
}

test('photos of every awkward size come back byte for byte, in pieces of 1 MB or less', async () => {
  const files = {
    'file:///c/a.jpg': bytesOf(1),
    'file:///c/b.jpg': bytesOf(PIECE_BYTES),
    'file:///c/c.jpg': bytesOf(PIECE_BYTES + 1),
    'file:///c/d.jpg': bytesOf(PIECE_BYTES * 3 + 12345),
    'file:///c/e.jpg': bytesOf(0),
  };
  const { picker } = fake(files);
  const picked = await picker.pick();
  assert.deepEqual(picked.map(p => p.bytes), Object.values(files).map(b => b.length));
  assert.equal(picked[0]!.type, 'image/jpeg');
  for (const p of picked) assert.ok((await download(picker, p.uri)).equals(files[p.uri as keyof typeof files]), p.uri);
});

test('backing out of the picker returns nothing and leaves nothing behind', async () => {
  const { picker, removed } = fake({}, { cancel: true });
  assert.deepEqual(await picker.pick(), []);
  assert.deepEqual(removed, []);
});

test('a second tap while the picker is open does nothing and does not break the first', async () => {
  let open!: () => void;
  const { picker } = fake({ 'file:///c/a.jpg': bytesOf(10) }, { hold: new Promise<void>(r => { open = r; }) });
  const first = picker.pick();
  assert.deepEqual(await picker.pick(), []);
  open();
  assert.equal((await first).length, 1);
  assert.equal((await picker.pick()).length, 1, 'the picker is free again afterwards');
});

test('a failed read cleans up the copies and rethrows', async () => {
  const { picker, removed } = fake({ 'file:///c/a.jpg': bytesOf(10) }, { sizeFails: true });
  await assert.rejects(picker.pick(), /gone/);
  assert.deepEqual(removed, ['file:///c/a.jpg']);
  await assert.rejects(picker.read('file:///c/a.jpg', 0), /no longer available/);
  assert.equal((await fake({}).picker.pick()).length, 0, 'and the picker is not stuck busy');
});

test('release deletes the copies once, and the page cannot read or delete anything it was not given', async () => {
  const { picker, removed } = fake({ 'file:///c/a.jpg': bytesOf(10), 'file:///secret/key': bytesOf(5) });
  await picker.pick();
  await assert.rejects(picker.read('file:///other/x.jpg', 0), /no longer available/);
  await assert.rejects(picker.read('file:///c/a.jpg', -1), /no longer available/);
  await picker.release(['file:///other/x.jpg']);
  assert.deepEqual(removed, []);
  await picker.release(['file:///c/a.jpg', 'file:///c/a.jpg']);
  assert.deepEqual(removed, ['file:///c/a.jpg']);
  await assert.rejects(picker.read('file:///c/a.jpg', 0), /no longer available/);
});

test('the phone page asks the app to pick, and never adds a camera path', () => {
  const shell = read('packages/design-editor-engine/shell-mobile.js');
  assert.match(shell, /call\('pickImages'\)/);
  assert.match(shell, /call\('readImage'/);
  assert.match(shell, /call\('releaseImages'/);
  assert.match(shell, /dispatchEvent\(new Event\('change'/);
  for (const f of ['mobile.html', 'desktop.html', 'app.js']) {
    assert.doesNotMatch(read(`packages/design-editor-engine/${f}`), /\bcapture\s*=|capture:/, `${f} must not ask for the camera`);
  }
  const bridge = read('apps/design-editor-mobile/src/editor/bridge.ts');
  const editor = read('apps/design-editor-mobile/app/editor.tsx');
  for (const t of ['pickImages', 'readImage', 'releaseImages']) {
    assert.ok(bridge.includes(`type: '${t}'`), `bridge.ts declares ${t}`);
    assert.ok(editor.includes(`case '${t}'`), `editor.tsx handles ${t}`);
  }
  assert.match(editor, /copyToCacheDirectory: true/);
  assert.match(editor, /type: 'image\/\*'/);
});
