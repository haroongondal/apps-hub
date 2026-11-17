import { test } from 'node:test';
import assert from 'node:assert/strict';

const ID = 'sieveid';
const BLOB = `blob:chrome-extension://${ID}/1111`;
const OFFSCREEN = { url: `chrome-extension://${ID}/offscreen.html` };
type Item = { id: number; url: string; state: string; filename: string; fileSize: number; error?: string };
type Delta = { id: number; filename?: { current: string }; state?: { current: string } };

// An in-memory `chrome`: session storage, downloads (download, search, onChanged) and a scripted runtime.sendMessage for the engine.
function setup(options: { download?: (o: Record<string, unknown>, session: Map<string, unknown>) => Promise<number>; send?: (m: Record<string, unknown>) => Promise<unknown> } = {}) {
  const session = new Map<string, unknown>();
  const items = new Map<number, Item>();
  const calls = { download: [] as Record<string, unknown>[], sent: [] as Record<string, unknown>[] };
  let changed: (d: Delta) => void = () => {};
  let nextId = 7;
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: async (key: string | null) => (key === null ? Object.fromEntries(session) : session.has(key) ? { [key]: structuredClone(session.get(key)) } : {}),
        set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => session.set(k, structuredClone(v))),
        remove: async (k: string | string[]) => void [k].flat().forEach((x) => session.delete(x)),
      },
    },
    downloads: {
      download: async (o: Record<string, unknown>) => {
        calls.download.push(o);
        const id = options.download ? await options.download(o, session) : nextId++;
        items.set(id, { id, url: String(o.url), state: 'in_progress', filename: '', fileSize: 0 });
        return id;
      },
      search: async (q: { id?: number; url?: string }) => [...items.values()].filter((i) => (q.id !== undefined ? i.id === q.id : i.url === q.url)),
      onChanged: { addListener: (cb: (d: Delta) => void) => void (changed = cb) },
    },
    runtime: {
      id: ID,
      getURL: (p: string) => `chrome-extension://${ID}/${p}`,
      getContexts: async () => [{}],
      sendMessage: async (m: Record<string, unknown>) => {
        calls.sent.push(m);
        return options.send ? options.send(m) : { ok: true };
      },
      onMessage: { addListener: () => {} },
    },
    declarativeNetRequest: { updateSessionRules: async () => {} },
  };
  return { session, items, calls, fire: (d: Delta) => changed(d) };
}

let n = 0;
const load = () => import(`../dl/save.ts?fresh=${++n}`) as Promise<typeof import('../dl/save.ts')>;
const msg = (over: Record<string, unknown> = {}) => ({ type: 'dl-sw-save', id: 'd1', blobUrl: BLOB, path: 'Archives/a.zip', size: 100, ...over });
const entry = (over: Record<string, unknown> = {}) => ({ id: 'd1', size: 100, path: 'Archives/a.zip', chromeId: null, ...over });
const settle = () => new Promise((r) => setTimeout(r, 20));
const events = (c: { sent: Record<string, unknown>[] }) => c.sent.filter((m) => m.type === 'dl-eng-save-event').map(({ type: _t, ...e }) => e);

test('onSave downloads the blob with the entry already stored, and replies with the chrome id', async () => {
  let seen: unknown;
  const env = setup({ download: async (_o, s) => ((seen = s.get(`dlSave:${BLOB}`)), 42) });
  const { onSave } = await load();
  assert.deepEqual(await onSave(msg(), OFFSCREEN as never), { ok: true, chromeId: 42 });
  assert.deepEqual(seen, entry());
  assert.deepEqual(env.session.get(`dlSave:${BLOB}`), entry({ chromeId: 42 }));
});

test('onSave calls chrome.downloads.download with the plan options', async () => {
  const env = setup();
  const { onSave } = await load();
  await onSave(msg(), OFFSCREEN as never);
  assert.deepEqual(env.calls.download, [{ url: BLOB, filename: 'Archives/a.zip', conflictAction: 'uniquify' }]);
});

test('onSave deletes the entry and replies ok false when download rejects', async () => {
  const env = setup({ download: async () => { throw new Error('boom'); } });
  const { onSave } = await load();
  assert.deepEqual(await onSave(msg(), OFFSCREEN as never), { ok: false, message: 'boom' });
  assert.equal(env.session.size, 0);
});

test('onSave rejects bad senders, blob URLs, paths and sizes without calling download', async () => {
  const env = setup();
  const { onSave } = await load();
  const bad: [unknown, unknown][] = [
    [msg(), { url: 'https://example.com/offscreen.html' }],
    [msg(), { url: `chrome-extension://${ID}/options.html` }],
    [msg(), {}],
    [msg({ blobUrl: 'blob:chrome-extension://other/1' }), OFFSCREEN],
    [msg({ blobUrl: 'https://example.com/x' }), OFFSCREEN],
    [msg({ path: '/etc/x' }), OFFSCREEN],
    [msg({ path: '../x' }), OFFSCREEN],
    [msg({ path: 'a/../b' }), OFFSCREEN],
    [msg({ path: 'a\\b' }), OFFSCREEN],
    [msg({ path: 'a'.repeat(401) }), OFFSCREEN],
    [msg({ size: NaN }), OFFSCREEN],
    [msg({ size: -1 }), OFFSCREEN],
    [null, OFFSCREEN],
  ];
  for (const [m, sender] of bad) assert.deepEqual(await onSave(m, sender as never), { ok: false, message: 'INVALID' }, JSON.stringify(m));
  assert.equal(env.calls.download.length, 0);
  assert.equal(env.session.size, 0);
});

test('onSave starts no second download for a record whose save is running or complete', async () => {
  const env = setup();
  const { onSave } = await load();
  const first = await onSave(msg(), OFFSCREEN as never);
  assert.deepEqual(await onSave(msg(), OFFSCREEN as never), first);
  Object.assign(env.items.get(7)!, { state: 'complete', fileSize: 100 });
  assert.deepEqual(await onSave(msg({ blobUrl: `${BLOB}2` }), OFFSCREEN as never), first);
  assert.equal(env.calls.download.length, 1);
  // an interrupted one is replaced, and its stale entry is dropped
  env.items.get(7)!.state = 'interrupted';
  assert.deepEqual(await onSave(msg({ blobUrl: `${BLOB}3` }), OFFSCREEN as never), { ok: true, chromeId: 8 });
  assert.deepEqual([...env.session.keys()], [`dlSave:${BLOB}3`]);
});

test('onSave for a record whose Chrome save already completed sends done again (the first done never reached the engine)', async () => {
  const env = setup();
  const { onSave } = await load();
  env.items.set(9, { id: 9, url: BLOB, state: 'complete', filename: '/dl/a.zip', fileSize: 100 });
  env.session.set(`dlSave:${BLOB}`, entry({ chromeId: 9 }));
  assert.deepEqual(await onSave(msg({ blobUrl: `${BLOB}2` }), OFFSCREEN as never), { ok: true, chromeId: 9 });
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'd1', kind: 'done', filename: '/dl/a.zip', chromeId: 9 }]);
  assert.equal(env.session.size, 0);
  assert.equal(env.calls.download.length, 0);
});

test('onSave replaces a completed Chrome save of the wrong size instead of reporting it forever', async () => {
  const env = setup();
  const { onSave } = await load();
  env.items.set(9, { id: 9, url: BLOB, state: 'complete', filename: '/dl/a.zip', fileSize: 60 });
  env.session.set(`dlSave:${BLOB}`, entry({ chromeId: 9 }));
  assert.deepEqual(await onSave(msg({ blobUrl: `${BLOB}2` }), OFFSCREEN as never), { ok: true, chromeId: 7 });
  assert.equal(env.calls.download.length, 1);
  assert.deepEqual([...env.session.keys()], [`dlSave:${BLOB}2`]);
});

test('onSave: two concurrent identical messages make one download', async () => {
  const env = setup({ download: async () => { await settle(); return 5; } });
  const { onSave } = await load();
  const [a, b] = await Promise.all([onSave(msg(), OFFSCREEN as never), onSave(msg(), OFFSCREEN as never)]);
  assert.deepEqual(a, b);
  assert.equal(env.calls.download.length, 1);
});

async function started(env: ReturnType<typeof setup>, over: Partial<Item> = {}) {
  const { initSave, onSave } = await load();
  initSave();
  await onSave(msg(), OFFSCREEN as never);
  Object.assign(env.items.get(7)!, over);
}

test('onChanged: a filename delta sends one path event', async () => {
  const env = setup();
  await started(env, { filename: '/dl/Archives/a.zip' });
  env.fire({ id: 7, filename: { current: '/dl/Archives/a.zip' } });
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'd1', kind: 'path', filename: '/dl/Archives/a.zip', chromeId: 7 }]);
  assert.equal(env.session.size, 1);
});

test('onChanged: complete with the right size sends done, then removes the entry after the engine answered', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const env = setup({ send: async () => { await gate; return { ok: true }; } });
  await started(env, { state: 'complete', filename: '/dl/Archives/a.zip', fileSize: 100 });
  env.fire({ id: 7, state: { current: 'complete' } });
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'd1', kind: 'done', filename: '/dl/Archives/a.zip', chromeId: 7 }]);
  assert.equal(env.session.size, 1);
  release();
  await settle();
  assert.equal(env.session.size, 0);
});

test('onChanged: a different size sends failed FILE_SIZE_MISMATCH', async () => {
  const env = setup();
  await started(env, { state: 'complete', fileSize: 99 });
  env.fire({ id: 7, state: { current: 'complete' } });
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'd1', kind: 'failed', error: 'FILE_SIZE_MISMATCH' }]);
});

test('onChanged: interrupted sends failed with the error', async () => {
  const env = setup();
  await started(env, { state: 'interrupted', error: 'FILE_NO_SPACE' });
  env.fire({ id: 7, state: { current: 'interrupted' } });
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'd1', kind: 'failed', error: 'FILE_NO_SPACE' }]);
  assert.equal(env.session.size, 0);
});

test('onChanged: an unknown url (an ordinary Chrome download) sends nothing', async () => {
  const env = setup();
  await started(env);
  env.items.set(99, { id: 99, url: 'https://example.com/x.zip', state: 'complete', filename: '/x', fileSize: 1 });
  env.fire({ id: 99, state: { current: 'complete' } });
  await settle();
  assert.equal(env.calls.sent.length, 0);
});

test('onChanged: a failing sendToEngine keeps the entry', async () => {
  const env = setup({ send: async () => { throw new Error('boom'); } });
  await started(env, { state: 'complete', fileSize: 100, filename: '/f' });
  env.fire({ id: 7, state: { current: 'complete' } });
  await settle();
  assert.equal(env.session.size, 1);
});

test('onChanged: filename and state in one delta send path before done', async () => {
  const env = setup();
  await started(env, { state: 'complete', fileSize: 100, filename: '/f' });
  env.fire({ id: 7, filename: { current: '/f' }, state: { current: 'complete' } });
  await settle();
  assert.deepEqual(events(env.calls).map((e) => e.kind), ['path', 'done']);
});

test('recoverSaves: complete sends done, interrupted sends failed, in_progress sends nothing', async () => {
  const env = setup();
  const { recoverSaves } = await load();
  for (const [i, state] of ['complete', 'interrupted', 'in_progress'].entries()) {
    const url = `${BLOB}r${i}`;
    env.items.set(20 + i, { id: 20 + i, url, state, filename: '/f', fileSize: 100 });
    env.session.set(`dlSave:${url}`, entry({ id: `r${i}`, chromeId: 20 + i }));
  }
  await recoverSaves();
  assert.deepEqual(events(env.calls), [
    { id: 'r0', kind: 'done', filename: '/f', chromeId: 20 },
    { id: 'r1', kind: 'failed', error: 'INTERRUPTED' },
  ]);
  assert.deepEqual([...env.session.keys()], [`dlSave:${BLOB}r2`]);
});

test('recoverSaves: an entry without a chrome id is adopted by url, or failed as NOT_STARTED and removed', async () => {
  const env = setup();
  const { recoverSaves } = await load();
  env.items.set(30, { id: 30, url: `${BLOB}a`, state: 'complete', filename: '/g', fileSize: 100 });
  env.session.set(`dlSave:${BLOB}a`, entry({ id: 'a' }));
  env.session.set(`dlSave:${BLOB}b`, entry({ id: 'b' }));
  await recoverSaves();
  assert.deepEqual(events(env.calls), [
    { id: 'a', kind: 'done', filename: '/g', chromeId: 30 },
    { id: 'b', kind: 'failed', error: 'NOT_STARTED' },
  ]);
  assert.equal(env.session.size, 0);
});

test('recoverSaves leaves an entry alone while onSave is still starting it', async () => {
  const env = setup({ download: async () => { await settle(); return 5; } });
  const { onSave, recoverSaves } = await load();
  const running = onSave(msg(), OFFSCREEN as never);
  await new Promise((r) => setTimeout(r, 5));
  await recoverSaves();
  assert.equal(events(env.calls).length, 0);
  await running;
});

test('initSave sends what Chrome finished while the worker was gone', async () => {
  const env = setup();
  const { initSave } = await load();
  env.items.set(40, { id: 40, url: `${BLOB}i`, state: 'complete', filename: '/h', fileSize: 100 });
  env.session.set(`dlSave:${BLOB}i`, entry({ id: 'i', chromeId: 40 }));
  initSave();
  await settle();
  assert.deepEqual(events(env.calls), [{ id: 'i', kind: 'done', filename: '/h', chromeId: 40 }]);
  assert.equal(env.session.size, 0);
});

test('recoverSaves sends no failure for a dead entry when a new save of that record starts while it looks', async () => {
  const env = setup({ download: async () => { await settle(); return 5; } });
  const { onSave, recoverSaves } = await load();
  env.session.set(`dlSave:${BLOB}old`, entry());
  const downloads = (globalThis as unknown as { chrome: { downloads: { search: (q: object) => Promise<unknown[]> } } }).chrome.downloads;
  const search = downloads.search;
  downloads.search = async (q) => (await new Promise((r) => setTimeout(r, 10)), search(q));
  const recovering = recoverSaves();
  await new Promise((r) => setTimeout(r, 2));
  const saving = onSave(msg(), OFFSCREEN as never); // the Resume that woke the worker
  await recovering;
  await saving;
  assert.deepEqual(events(env.calls), [], 'the engine must not fail a record whose new save is running');
});

test('recoverSaves leaves a record alone when a new save of it started and finished starting while it looked', async () => {
  const env = setup();
  const { onSave, recoverSaves } = await load();
  env.items.set(9, { id: 9, url: BLOB, state: 'interrupted', filename: '', fileSize: 0, error: 'NETWORK_FAILED' });
  env.session.set(`dlSave:${BLOB}`, entry({ chromeId: 9 }));
  const downloads = (globalThis as unknown as { chrome: { downloads: { search: (q: object) => Promise<unknown[]> } } }).chrome.downloads;
  const search = downloads.search;
  let first = true;
  downloads.search = async (q) => {
    if (first) (first = false, await new Promise((r) => setTimeout(r, 30)));
    return search(q);
  };
  const recovering = recoverSaves();
  await new Promise((r) => setTimeout(r, 2));
  assert.deepEqual(await onSave(msg(), OFFSCREEN as never), { ok: true, chromeId: 7 }); // the same blob URL, a new Chrome item
  await recovering;
  await settle();
  assert.deepEqual(events(env.calls), [], 'the old item must not fail the new save');
  assert.deepEqual(env.session.get(`dlSave:${BLOB}`), entry({ chromeId: 7 }), 'the new save keeps its entry');
});
