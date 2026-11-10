import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_DOWNLOADS, validateDownloadSettings, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';

const BASE = 'chrome-extension://sieve/';
type Listener = (message: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;
type Change = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

// An in-memory `chrome`: slow storage, a runtime whose sendMessage the test scripts, and an offscreen API that records createDocument.
function setup(options: { documents?: number; sendMessage?: (m: unknown) => Promise<unknown>; createDocument?: () => Promise<void>; setFails?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const calls = { create: [] as unknown[], send: [] as unknown[], get: 0 };
  const changed: Change[] = [];
  const listeners: Listener[] = [];
  let documents = options.documents ?? 0;
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          calls.get++;
          await sleep(3);
          return store.has(key) ? { [key]: structuredClone(store.get(key)) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          await sleep(3);
          if (options.setFails) throw new Error('QUOTA_BYTES quota exceeded');
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
      onChanged: { addListener: (cb: Change) => void changed.push(cb) },
    },
    runtime: {
      getURL: (p: string) => BASE + p,
      getContexts: async () => {
        await sleep(2);
        return Array.from({ length: documents }, () => ({}));
      },
      sendMessage: async (m: unknown) => {
        calls.send.push(m);
        return options.sendMessage ? options.sendMessage(m) : { ok: true };
      },
      onMessage: { addListener: (cb: Listener) => void listeners.push(cb) },
    },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    offscreen: {
      createDocument: async (p: unknown) => {
        calls.create.push(p);
        await sleep(5);
        await options.createDocument?.();
        documents++;
      },
    },
  };
  console.error = () => {};
  return { store, calls, changed, listeners };
}

let n = 0;
const fresh = <T>(file: string) => import(`../dl/${file}?fresh=${++n}`) as Promise<T>;
type Link = typeof import('../dl/engine-link.ts');
type Store = typeof import('../dl/settings-store.ts');
const noDoc = 'Could not establish connection. Receiving end does not exist.';

test('ensureEngine called five times at once calls createDocument once, with the parameters of the plan', async () => {
  const t = setup();
  const { ensureEngine } = await fresh<Link>('engine-link.ts');
  await Promise.all([1, 2, 3, 4, 5].map(() => ensureEngine()));
  assert.deepEqual(t.calls.create, [
    { url: 'offscreen.html', reasons: ['WORKERS', 'BLOBS'], justification: "Downloads files in the background so a download keeps going when Chrome stops the extension's service worker." },
  ]);
});

test('ensureEngine calls createDocument zero times when getContexts already lists a document', async () => {
  const t = setup({ documents: 1 });
  const { ensureEngine } = await fresh<Link>('engine-link.ts');
  await ensureEngine();
  assert.equal(t.calls.create.length, 0);
});

test('ensureEngine does not throw when createDocument rejects with "Only a single offscreen document may be created."', async () => {
  setup({ createDocument: () => Promise.reject(new Error('Only a single offscreen document may be created.')) });
  const { ensureEngine } = await fresh<Link>('engine-link.ts');
  await ensureEngine();
  const other = setup({ createDocument: () => Promise.reject(new Error('Extension context invalidated.')) });
  const again = await fresh<Link>('engine-link.ts');
  await assert.rejects(again.ensureEngine(), /invalidated/);
  assert.equal(other.calls.create.length, 1);
});

test('sendToEngine retries "Receiving end does not exist" and calls ensureEngine each time, answering after 3 calls', async () => {
  let tries = 0;
  const t = setup({ sendMessage: async () => (++tries < 3 ? Promise.reject(new Error(noDoc)) : { ok: true }) });
  const { sendToEngine } = await fresh<Link>('engine-link.ts');
  assert.deepEqual(await sendToEngine({ type: 'dl-eng-tick' }), { ok: true });
  assert.equal(t.calls.send.length, 3);
  assert.equal(t.calls.create.length, 1, 'the first call created the document; the others found it');
});

test('sendToEngine calls ensureEngine again inside each retry (the document may have closed meanwhile)', async () => {
  let tries = 0;
  let closeIt: () => void = () => {};
  const t = setup({
    sendMessage: async () => {
      if (++tries === 1) {
        closeIt();
        throw new Error(noDoc);
      }
      return { ok: true };
    },
  });
  closeIt = () => {
    (globalThis as unknown as { chrome: { runtime: { getContexts: () => Promise<unknown[]> } } }).chrome.runtime.getContexts = async () => [];
  };
  const { sendToEngine } = await fresh<Link>('engine-link.ts');
  await sendToEngine({ type: 'dl-eng-tick' });
  assert.equal(t.calls.create.length, 2, 'created once for the first call, and again after the document closed');
});

test('sendToEngine rejects after ten "Receiving end does not exist" rejections', async () => {
  const t = setup({ sendMessage: () => Promise.reject(new Error(noDoc)) });
  const { sendToEngine } = await fresh<Link>('engine-link.ts');
  await assert.rejects(sendToEngine({ type: 'dl-eng-tick' }), /Receiving end/);
  assert.equal(t.calls.send.length, 10);
});

test('sendToEngine rejects at once on a different error', async () => {
  const t = setup({ sendMessage: () => Promise.reject(new Error('Extension context invalidated.')) });
  const { sendToEngine } = await fresh<Link>('engine-link.ts');
  await assert.rejects(sendToEngine({ type: 'dl-eng-tick' }), /invalidated/);
  assert.equal(t.calls.send.length, 1);
});

const closed = 'The message port closed before a response was received.';
test('sendToEngine retries "message port closed" for a dl-eng-add whose items all have a chromeId', async () => {
  let tries = 0;
  const t = setup({ sendMessage: async () => (++tries < 2 ? Promise.reject(new Error(closed)) : { ids: ['a'] }) });
  const { sendToEngine } = await fresh<Link>('engine-link.ts');
  const items = [{ url: 'https://x.test/a', source: 'takeover', chromeId: 4 }];
  assert.deepEqual(await sendToEngine({ type: 'dl-eng-add', items }), { ids: ['a'] });
  assert.equal(t.calls.send.length, 2);
});

test('sendToEngine rejects at once on "message port closed" for dl-eng-do and for a dl-eng-add with an item without chromeId', async () => {
  const t = setup({ sendMessage: () => Promise.reject(new Error(closed)) });
  const { sendToEngine, addRecords } = await fresh<Link>('engine-link.ts');
  await assert.rejects(sendToEngine({ type: 'dl-eng-do', op: 'pause', ids: ['a'] }), /port closed/);
  assert.equal(t.calls.send.length, 1);
  const items = [{ url: 'https://x.test/a', source: 'takeover' as const, chromeId: 4 }, { url: 'https://x.test/b', source: 'manual' as const }];
  assert.equal(await addRecords(items), null);
  assert.equal(t.calls.send.length, 2, 'one more call, no retry');
});

test('addRecords returns null when sendToEngine rejects, and the ids when the engine answers', async () => {
  setup({ sendMessage: () => Promise.reject(new Error('Extension context invalidated.')) });
  assert.equal(await (await fresh<Link>('engine-link.ts')).addRecords([{ url: 'https://x.test/a', source: 'manual' }]), null);
  setup({ sendMessage: async () => ({ ids: ['x'] }) });
  assert.deepEqual(await (await fresh<Link>('engine-link.ts')).addRecords([{ url: 'https://x.test/a', source: 'manual' }]), { ids: ['x'] });
  setup({ sendMessage: async () => ({ error: 'TIMEOUT' }) });
  assert.equal(await (await fresh<Link>('engine-link.ts')).addRecords([{ url: 'https://x.test/a', source: 'manual' }]), null);
});

test('fromExtensionPage accepts the extension page and refuses a web page, no url and another extension', async () => {
  setup();
  const { fromExtensionPage } = await fresh<Link>('engine-link.ts');
  assert.equal(fromExtensionPage({ url: BASE + 'options.html' } as chrome.runtime.MessageSender), true);
  assert.equal(fromExtensionPage({ url: 'https://example.com/' } as chrome.runtime.MessageSender), false);
  assert.equal(fromExtensionPage({} as chrome.runtime.MessageSender), false);
  assert.equal(fromExtensionPage({ url: 'chrome-extension://other/x.html' } as chrome.runtime.MessageSender), false);
});

test('saveDownloads: two concurrent edits both land with slow get and set', async () => {
  const t = setup();
  const { saveDownloads, readDownloads } = await fresh<Store>('settings-store.ts');
  const results = await Promise.all([saveDownloads((s) => ({ ...s, parts: 3 })), saveDownloads((s) => ({ ...s, speedLimit: { ...s.speedLimit, on: true } }))]);
  assert.deepEqual(results, [true, true]);
  const saved = await readDownloads();
  assert.equal(saved.parts, 3);
  assert.equal(saved.speedLimit.on, true);
  assert.ok(t.store.has('downloads'));
});

test('saveDownloads resolves false when set fails', async () => {
  setup({ setFails: true });
  const { saveDownloads } = await fresh<Store>('settings-store.ts');
  assert.equal(await saveDownloads((s) => s), false);
});

test('readDownloads on garbage gives DEFAULT_DOWNLOADS', async () => {
  const t = setup();
  const { readDownloads } = await fresh<Store>('settings-store.ts');
  t.store.set('downloads', 'garbage');
  assert.deepEqual(await readDownloads(), DEFAULT_DOWNLOADS);
  t.store.set('downloads', { version: 7 });
  assert.deepEqual(await readDownloads(), DEFAULT_DOWNLOADS);
});

test('getDownloads returns the cached copy until an onChanged for downloads arrives, then re-reads', async () => {
  const t = setup();
  const { getDownloads } = await fresh<Store>('settings-store.ts');
  assert.equal((await getDownloads()).parts, 1);
  t.store.set('downloads', { ...DEFAULT_DOWNLOADS, parts: 4 });
  assert.equal((await getDownloads()).parts, 1, 'still the cached copy');
  assert.equal(t.calls.get, 1);
  for (const cb of t.changed) cb({ settings: {} }, 'local');
  assert.equal((await getDownloads()).parts, 1, 'another key changed: still cached');
  for (const cb of t.changed) cb({ downloads: { newValue: t.store.get('downloads') } }, 'sync');
  assert.equal((await getDownloads()).parts, 1, 'another area changed: still cached');
  for (const cb of t.changed) cb({ downloads: { newValue: t.store.get('downloads') } }, 'local');
  assert.equal((await getDownloads()).parts, 4);
  assert.equal(t.calls.get, 2);
});

test('onDownloadsChanged hands the validated settings to the callback', async () => {
  const t = setup();
  const { onDownloadsChanged } = await fresh<Store>('settings-store.ts');
  const seen: DownloadSettings[] = [];
  onDownloadsChanged((s) => seen.push(s));
  for (const cb of t.changed) {
    cb({ downloads: { newValue: { ...DEFAULT_DOWNLOADS, parts: 99 } } }, 'local');
    cb({ downloads: { newValue: 'junk' } }, 'local');
    cb({ settings: { newValue: {} } }, 'local');
  }
  assert.deepEqual(seen.map((s) => s.parts), [6, 1]);
  assert.deepEqual(seen[1], validateDownloadSettings(undefined));
});

// The router: a fresh copy per test, run against the same in-memory chrome.
async function router(options: Parameters<typeof setup>[0] = {}) {
  const t = setup(options);
  const { initRouter } = await fresh<{ initRouter(): void }>('router.ts');
  initRouter();
  assert.equal(t.listeners.length, 1);
  const send = (message: unknown, url = BASE + 'options.html') =>
    new Promise<{ keepsOpen: boolean; reply?: unknown }>((resolve) => {
      let reply: unknown;
      const keepsOpen = t.listeners[0](message, { url }, (r) => resolve({ keepsOpen, reply: (reply = r) }));
      if (!keepsOpen) resolve({ keepsOpen, reply });
    });
  return { ...t, send };
}
const item = (extra: Record<string, unknown> = {}) => ({ url: 'https://example.com/a.zip', source: 'manual', ...extra });
const refused = { ok: false, message: T.addFailed };

test('router ignores a dl-add from a web page sender (returns false)', async () => {
  const t = await router();
  const r = await t.send({ type: 'dl-add', items: [item()] }, 'https://example.com/');
  assert.deepEqual(r, { keepsOpen: false, reply: undefined });
  assert.equal(t.calls.send.length, 0);
});

test('router refuses dl-add with no items, 501 items, a ftp URL, source takeover, a probed field, a bad category, a 25 character queue and a chromeId', async () => {
  const t = await router();
  const bad: unknown[] = [
    { type: 'dl-add', items: [] },
    { type: 'dl-add', items: Array.from({ length: 501 }, () => item()) },
    { type: 'dl-add' },
    { type: 'dl-add', items: [item({ url: 'ftp://x/y' })] },
    { type: 'dl-add', items: [item({ url: 'not a url' })] },
    { type: 'dl-add', items: [item({ source: 'takeover' })] },
    { type: 'dl-add', items: [item({ source: undefined })] },
    { type: 'dl-add', items: [item({ probed: { finalUrl: 'https://x/y', size: 1, mime: '', validator: null, name: 'y' } })] },
    { type: 'dl-add', items: [item({ category: 'nope' })] },
    { type: 'dl-add', items: [item({ queue: 'q'.repeat(25) })] },
    { type: 'dl-add', items: [item({ chromeId: 5 })] },
    { type: 'dl-add', items: [item({ referrer: 'ftp://x/' })] },
    { type: 'dl-add', items: [item({ name: 'n'.repeat(301) })] },
    { type: 'dl-add', items: [item(), 'text'] },
  ];
  for (const message of bad) assert.deepEqual((await t.send(message)).reply, refused, JSON.stringify(message).slice(0, 80));
  assert.equal(t.calls.send.length, 0, 'nothing reached the engine, and no engine was created');
  assert.equal(t.calls.create.length, 0);
});

test('router replies { ok: true, ids } for a valid dl-add, and accepts every optional field', async () => {
  const t = await router({ documents: 1, sendMessage: async () => ({ ids: ['x'] }) });
  const full = item({ referrer: 'https://example.com/page', name: 'a.zip', category: 'archives', queue: 'main', source: 'menu' });
  assert.deepEqual((await t.send({ type: 'dl-add', items: [item(), full] })).reply, { ok: true, ids: ['x'] });
  assert.deepEqual(t.calls.send, [{ type: 'dl-eng-add', items: [item(), full] }]);
});

test('router replies the add failure when the engine cannot be reached', async () => {
  const t = await router({ documents: 1, sendMessage: () => Promise.reject(new Error('Extension context invalidated.')) });
  assert.deepEqual((await t.send({ type: 'dl-add', items: [item()] })).reply, refused);
});

test('router forwards a valid dl-do and replies { ok: true }', async () => {
  const t = await router({ documents: 1 });
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'pause', ids: [] })).reply, { ok: true });
  assert.deepEqual(t.calls.send, [{ type: 'dl-eng-do', op: 'pause', ids: [] }]);
});

test('router replies { ok: false, message: T.actionFailed } for dl-do with op delete, bad ids and a failing engine', async () => {
  const t = await router({ documents: 1 });
  const failed = { ok: false, message: T.actionFailed };
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'delete', ids: [] })).reply, failed);
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'pause', ids: [1] })).reply, failed);
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'pause', ids: Array.from({ length: 501 }, () => 'a') })).reply, failed);
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'pause' })).reply, failed);
  const down = await router({ documents: 1, sendMessage: () => Promise.reject(new Error('Extension context invalidated.')) });
  assert.deepEqual((await down.send({ type: 'dl-do', op: 'resume', ids: ['a'] })).reply, failed);
  assert.equal(t.calls.send.length, 0);
});

test('router replies the validated settings to dl-sw-ready', async () => {
  const t = await router();
  assert.deepEqual((await t.send({ type: 'dl-sw-ready' })).reply, { settings: DEFAULT_DOWNLOADS });
  t.store.set('downloads', { ...DEFAULT_DOWNLOADS, parts: 3 });
  assert.equal(((await t.send({ type: 'dl-sw-ready' })).reply as { settings: DownloadSettings }).settings.parts, 3);
});

test('router returns false for an unknown type and for something that is not a message', async () => {
  const t = await router();
  assert.equal((await t.send({ type: 'pick', host: 'a', selector: 'b' })).keepsOpen, false);
  assert.equal((await t.send({ type: 'dl-state' })).keepsOpen, false);
  assert.equal((await t.send('dl-add')).keepsOpen, false);
  assert.equal((await t.send(null)).keepsOpen, false);
});

test('router replies { ok: false, message: T.actionFailed } when the engine answers { error: "TIMEOUT" }', async () => {
  const t = await router({ documents: 1, sendMessage: async () => ({ error: 'TIMEOUT' }) });
  assert.deepEqual((await t.send({ type: 'dl-do', op: 'pause', ids: ['a'] })).reply, { ok: false, message: T.actionFailed });
});

// The offscreen relay, run against a fake Worker that answers every request at once.
test('the offscreen relay takes commands only from the extension, and only real command types', async () => {
  const t = setup({ sendMessage: async () => ({ settings: DEFAULT_DOWNLOADS }) });
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(m: { id: number }) {
      queueMicrotask(() => this.onmessage?.({ data: { reply: m.id, result: { ok: true } } }));
    }
    terminate() {}
  }
  (globalThis as unknown as Record<string, unknown>).Worker = FakeWorker;
  await import(`../offscreen/offscreen.ts?fresh=${++n}`);
  await sleep(30);
  const [listener] = t.listeners;
  const ask = (message: unknown, url: string | undefined) =>
    new Promise<{ keepsOpen: boolean; reply?: unknown }>((resolve) => {
      const keepsOpen = listener(message, { url }, (reply) => resolve({ keepsOpen, reply }));
      if (!keepsOpen) resolve({ keepsOpen });
    });
  assert.deepEqual(await ask({ type: 'dl-eng-tick' }, BASE + 'background.js'), { keepsOpen: true, reply: { ok: true } });
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'dl-state']) assert.deepEqual(await ask({ type }, BASE + 'background.js'), { keepsOpen: false }, type);
  assert.deepEqual(await ask({ type: 'dl-eng-tick' }, 'https://example.com/'), { keepsOpen: false }, 'a web page (a content script) is refused');
  assert.deepEqual(await ask({ type: 'dl-eng-tick' }, undefined), { keepsOpen: false });
  assert.deepEqual(await ask({ type: 'dl-eng-tick' }, 'chrome-extension://other/x.html'), { keepsOpen: false });
  assert.deepEqual(await ask(null, BASE + 'background.js'), { keepsOpen: false });
});
