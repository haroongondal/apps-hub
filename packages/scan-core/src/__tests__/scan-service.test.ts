import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ScanService, ScanError } from '../scan-service.ts';
import { ScanStore } from '../scan-store.ts';
import { defaultTitle } from '../titles.ts';
import type { SessionInput } from '../types.ts';
import { TINY_JPEG, checkXref, fakeNative, latin1, nodeFiles, openLibrary } from './helpers.ts';

const FULL = [0, 0, 1, 0, 1, 1, 0, 1];

async function setup(opts: { failOnProcess?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scan-core-'));
  const libraryDir = join(root, 'library');
  const exportDir = join(root, 'export');
  const sessionDir = join(root, 'session');
  await mkdir(libraryDir);
  await mkdir(sessionDir);
  let tick = 1_700_000_000_000;
  const { lib, db } = await openLibrary(() => ++tick);
  const store = await ScanStore.open(db);
  const native = fakeNative(opts);
  const files = nodeFiles(root);
  let n = 0;
  const service = new ScanService({
    library: lib, store, native, files, libraryDir, exportDir,
    newPageId: () => `pg${++n}`,
    newItemId: () => `item${String(++n).padStart(12, '0')}`,
    now: () => new Date(2026, 9, 31, 14, 5).getTime(),
  });
  const capture = async (name: string) => {
    await writeFile(join(sessionDir, name), TINY_JPEG);
    return join(sessionDir, name);
  };
  const session = async (count: number, extra: Partial<SessionInput> = {}): Promise<SessionInput> => ({
    folderId: null,
    appendTo: null,
    mode: 'document',
    sheet: false,
    pages: await Promise.all(
      Array.from({ length: count }, async (_, i) => ({
        file: await capture(`cap-${i}.jpg`), quad: null, rotation: 0 as const, filter: 'auto' as const, side: null,
      })),
    ),
    ...extra,
  });
  return { service, lib, store, native, libraryDir, exportDir, session, files, db };
}

test('defaultTitle is local time, zero-padded', () => {
  assert.equal(defaultTitle('document', new Date(2026, 9, 31, 4, 5).getTime()), 'Scan 2026-10-31 04:05');
  assert.equal(defaultTitle('card', new Date(2026, 0, 2, 14, 30).getTime()), 'Card 2026-01-02 14:30');
});

test('saving three pages makes one scan item with files, thumb and rows', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(3));
  assert.equal(item.kind, 'scan');
  assert.equal(item.pageCount, 3);
  assert.equal(item.title, 'Scan 2026-10-31 14:05');
  assert.ok(item.sizeBytes > 0);
  const names = await readdir(join(s.libraryDir, item.id, 'pages'));
  assert.equal(names.filter((f) => f.endsWith('.orig.jpg')).length, 3);
  assert.equal(names.filter((f) => /^pg\d+\.jpg$/.test(f)).length, 3);
  assert.ok((await readdir(join(s.libraryDir, item.id))).includes('thumb.jpg'));
  const pages = await s.service.pages(item.id);
  assert.deepEqual(pages.map((p) => p.position), [0, 1, 2]);
  assert.ok(pages.every((p) => p.ocrState === 'pending' && p.kind === 'page'));
  assert.deepEqual(s.native.processCalls.at(-1)?.maxLongSide, 320);
});

test('a page with no detected border is processed as the full frame', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(1), { title: 'One' });
  assert.deepEqual(s.native.processCalls[0].quad, FULL);
  assert.deepEqual((await s.service.pages(item.id))[0].quad, FULL);
  assert.equal(item.title, 'One');
});

test('a card session with sheet composes one sheet page', async () => {
  const s = await setup();
  const base = await s.session(2, { mode: 'card', sheet: true });
  base.pages[0].side = 'front';
  base.pages[1].side = 'back';
  const item = await s.service.saveSession(base);
  assert.equal(s.native.sheetCalls.length, 1);
  assert.ok(s.native.sheetCalls[0].front && s.native.sheetCalls[0].back);
  assert.equal(item.pageCount, 1);
  const [page] = await s.service.pages(item.id);
  assert.equal(page.kind, 'sheet');
  assert.equal(page.filter, 'original');
  assert.deepEqual(page.quad, FULL);
  assert.equal(item.title, 'Card 2026-10-31 14:05');
  assert.ok(!(await readdir(join(s.libraryDir, item.id))).includes('tmp'));
});

test('a one-card sheet has no back', async () => {
  const s = await setup();
  await s.service.saveSession(await s.session(1, { mode: 'card', sheet: true }));
  assert.equal(s.native.sheetCalls[0].back, null);
});

test('a card session without sheet saves card pages at 1600 px', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(2, { mode: 'card' }));
  const pages = await s.service.pages(item.id);
  assert.deepEqual(pages.map((p) => p.kind), ['card', 'card']);
  assert.deepEqual(s.native.processCalls.slice(0, 2).map((c) => c.maxLongSide), [1600, 1600]);
  assert.equal(s.native.sheetCalls.length, 0);
});

test('zero pages is refused and creates nothing', async () => {
  const s = await setup();
  await assert.rejects(s.service.saveSession(await s.session(0)), (e: ScanError) => e.code === 'no_pages');
  assert.deepEqual(await s.lib.list({ everywhere: true }), []);
});

test('a failing page leaves no item and no directory', async () => {
  const s = await setup({ failOnProcess: 2 });
  await assert.rejects(s.service.saveSession(await s.session(3)), /decode_failed/);
  assert.deepEqual(await s.lib.list({ everywhere: true }), []);
  assert.deepEqual(await readdir(s.libraryDir), []);
});

test('appendTo adds pages after the existing ones and updates counts', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(2));
  const before = s.native.processCalls.length;
  const updated = await s.service.saveSession(await s.session(2, { appendTo: item.id }));
  assert.equal(updated.id, item.id);
  assert.equal(updated.pageCount, 4);
  assert.ok(updated.sizeBytes >= item.sizeBytes);
  assert.deepEqual((await s.service.pages(item.id)).map((p) => p.position), [0, 1, 2, 3]);
  assert.equal(s.native.processCalls.length - before, 2, 'no thumbnail change');
  await assert.rejects(s.service.saveSession(await s.session(1, { appendTo: 'nope' })), (e: ScanError) => e.code === 'not_found');
});

test('editPage reprocesses from the original and drops a stale .bits', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(1));
  const [page] = await s.service.pages(item.id);
  const bitsPath = join(s.libraryDir, item.id, 'pages', `${page.pageId}.bits`);
  const calls = s.native.processCalls.length;
  const bw = await s.service.editPage(item.id, page.pageId, { filter: 'bw' });
  assert.equal(s.native.processCalls.length, calls + 1);
  assert.deepEqual([bw.filter, bw.bitsWidth], ['bw', 2480]);
  assert.ok((await readdir(join(s.libraryDir, item.id, 'pages'))).includes(`${page.pageId}.bits`));
  const before = (await s.lib.getItem(item.id))!.updatedAt;
  const auto = await s.service.editPage(item.id, page.pageId, { filter: 'auto', rotation: 90 });
  assert.deepEqual([auto.filter, auto.bitsWidth, auto.rotation], ['auto', null, 90]);
  assert.ok(!(await readdir(join(s.libraryDir, item.id, 'pages'))).includes(`${page.pageId}.bits`), bitsPath);
  assert.ok((await s.lib.getItem(item.id))!.updatedAt > before);
  await assert.rejects(s.service.editPage(item.id, 'zz', {}), (e: ScanError) => e.code === 'not_found');
});

test('deletePage removes files and row, and the last page is protected', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(2));
  const [a, b] = await s.service.pages(item.id);
  await s.service.deletePage(item.id, a.pageId);
  assert.deepEqual((await s.service.pages(item.id)).map((p) => [p.pageId, p.position]), [[b.pageId, 0]]);
  assert.equal((await s.lib.getItem(item.id))!.pageCount, 1);
  assert.ok(!(await readdir(join(s.libraryDir, item.id, 'pages'))).some((f) => f.startsWith(a.pageId)));
  await assert.rejects(s.service.deletePage(item.id, b.pageId), (e: ScanError) => e.code === 'last_page');
});

test('reorder needs every page exactly once', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(3));
  const ids = (await s.service.pages(item.id)).map((p) => p.pageId);
  await s.service.reorder(item.id, [ids[2], ids[0], ids[1]]);
  assert.deepEqual((await s.service.pages(item.id)).map((p) => p.pageId), [ids[2], ids[0], ids[1]]);
  for (const bad of [[ids[0], ids[1]], [ids[0], ids[1], 'zz'], [ids[0], ids[0], ids[1]]]) {
    await assert.rejects(s.service.reorder(item.id, bad), (e: ScanError) => e.code === 'bad_order');
  }
  assert.deepEqual(await s.service.pageTexts(item.id), ['', '', '']);
});

test('imagePaths lists processed JPEGs in page order', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(3));
  const ids = (await s.service.pages(item.id)).map((p) => p.pageId);
  const all = await s.service.imagePaths(item.id);
  assert.deepEqual(all.map((p) => p.split('/').at(-1)), ids.map((id) => `${id}.jpg`));
  assert.equal((await s.service.imagePaths(item.id, [ids[1]])).length, 1);
  await assert.rejects(s.service.imagePaths(item.id, ['zz']), (e: ScanError) => e.code === 'not_found');
});

test('buildPdf writes a valid PDF with one page per scan page, bw pages as bits', async () => {
  const s = await setup();
  const item = await s.service.saveSession(await s.session(2), { title: 'A/B: "x" #42 100%' });
  const [, second] = await s.service.pages(item.id);
  await s.service.editPage(item.id, second.pageId, { filter: 'bw' });
  const { path, bytes } = await s.service.buildPdf(item.id);
  assert.ok(path.endsWith('/A-B- -x- -42 100-.pdf'), path);
  assert.ok(!/[#%?]/.test(path), path);
  const pdf = latin1(await s.files.read(path));
  assert.equal(pdf.length, bytes);
  assert.equal(checkXref(pdf), 10 + 3 * 2);
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /\/DCTDecode/);
  assert.match(pdf, /\/BitsPerComponent 1/);
  assert.ok(!(await readdir(s.exportDir)).some((f) => f.endsWith('.tmp')));
});
