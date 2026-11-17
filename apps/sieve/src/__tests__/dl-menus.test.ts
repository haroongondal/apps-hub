import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DOWNLOADS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { collectAll, collectSelected, normaliseLinks } from '../dl/links.ts';
import { initMenus, onMenuClicked, rebuildMenus } from '../dl/menus.ts';

const BASE = 'chrome-extension://sieve/';
type Msg = (m: unknown, sender: unknown, reply: (r: unknown) => void) => boolean;

function setup(options: { on?: boolean; result?: unknown[]; reject?: boolean; tabs?: { id: number; windowId?: number }[] } = {}) {
  const items: { id: string; title: string; contexts: string[] }[] = [];
  const log: string[] = [];
  const onClicked: unknown[] = [];
  const onInstalled: unknown[] = [];
  const onChanged: ((c: Record<string, { newValue?: unknown }>, area: string) => void)[] = [];
  const calls = { reload: [] as unknown[], removeAll: 0, scripts: [] as { target: { tabId: number; frameIds: number[] } }[], created: [] as { url: string }[], updated: [] as unknown[], windows: [] as unknown[] };
  const session = new Map<string, unknown>();
  const messageListeners: Msg[] = [];
  const state = { on: options.on ?? true, lastError: undefined as unknown };
  (globalThis as unknown as Record<string, unknown>).chrome = {
    contextMenus: {
      removeAll: async () => {
        calls.removeAll++;
        log.push('remove-start');
        await new Promise((r) => setTimeout(r, 2));
        items.length = 0;
        log.push('remove-end');
      },
      create: (item: { id: string; title: string; contexts: string[] }, done?: () => void) => {
        log.push(done ? 'create' : 'create without a callback');
        items.push(item);
        done?.(); // Chrome reports a duplicate id through runtime.lastError in this callback
      },
      onClicked: { addListener: (cb: unknown) => void onClicked.push(cb) },
    },
    scripting: {
      executeScript: async (inj: { target: { tabId: number; frameIds: number[] } }) => {
        calls.scripts.push(inj);
        if (options.reject) throw new Error('Cannot access contents of the page');
        return [{ result: options.result }];
      },
    },
    storage: {
      local: { get: async () => ({ downloads: { ...DEFAULT_DOWNLOADS, on: state.on } }) },
      session: { set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => session.set(k, v)) },
      onChanged: { addListener: (cb: (typeof onChanged)[number]) => void onChanged.push(cb) },
    },
    tabs: {
      create: async (p: { url: string }) => void calls.created.push(p),
      update: async (...a: unknown[]) => void calls.updated.push(a),
      reload: async (id: number) => void calls.reload.push(id),
    },
    windows: { update: async (...a: unknown[]) => void calls.windows.push(a) },
    runtime: { get lastError() { return state.lastError; }, getURL: (p: string) => BASE + p, getContexts: async () => [{ tabId: -1, windowId: -1, documentUrl: `${BASE}offscreen.html` }, ...(options.tabs ?? []).map((x) => ({ tabId: x.id, windowId: x.windowId, documentUrl: `${BASE}downloads.html#add` }))], onInstalled: { addListener: (cb: unknown) => void onInstalled.push(cb) }, onMessage: { addListener: (cb: Msg) => void messageListeners.push(cb) } },
  };
  return { items, calls, session, messageListeners, log, onClicked, onInstalled, onChanged, state };
}

test('normaliseLinks keeps http(s), normalises, deduplicates and caps', () => {
  assert.deepEqual(normaliseLinks(['https://a.com/x', 'https://a.com/x', 'ftp://b', 'mailto:c@d', 'http://e.org', '', 'not a url']), ['https://a.com/x', 'http://e.org/']);
  assert.equal(normaliseLinks(Array.from({ length: 600 }, (_, i) => `https://a.com/${i}`)).length, 500);
  assert.equal(normaliseLinks(['https://a.com/1', 'https://a.com/2', 'https://a.com/3'], 2).length, 2);
});

test('rebuildMenus removes all first, creates three items when on, none when off, and is idempotent', async () => {
  const { items, calls, state } = setup();
  await rebuildMenus();
  assert.equal(calls.removeAll, 1);
  assert.deepEqual(items, [
    { id: 'dl-link', title: T.ctxLink, contexts: ['link'] },
    { id: 'dl-selection', title: T.ctxSelection, contexts: ['selection'] },
    { id: 'dl-page', title: T.ctxPage, contexts: ['page', 'frame'] },
  ]);
  await Promise.all([rebuildMenus(), rebuildMenus()]);
  assert.equal(items.length, 3);
  state.on = false;
  await rebuildMenus();
  assert.equal(items.length, 0);
});

test('overlapping rebuilds run one after the other and leave exactly three items', async () => {
  const { items, log } = setup();
  await Promise.all([rebuildMenus(), rebuildMenus()]);
  const one = ['remove-start', 'remove-end', 'create', 'create', 'create'];
  assert.deepEqual(log, [...one, ...one]);
  assert.equal(items.length, 3);
});

test('a rebuild reads the settings when its turn comes: a rebuild queued before a change cannot win over it', async () => {
  const { items, state } = setup();
  const first = rebuildMenus(); // still removing when the setting changes
  state.on = false;
  await Promise.all([first, rebuildMenus()]);
  assert.equal(items.length, 0);
});

test('every menu item is created with a callback, so a duplicate id is a checked lastError and not an uncaught one', async () => {
  const { log, state } = setup();
  state.lastError = { message: 'Cannot create item with duplicate id dl-link' };
  await rebuildMenus();
  assert.deepEqual(log.filter((x) => x.startsWith('create')), ['create', 'create', 'create']);
});

test('the install listener rebuilds and a failing settings read there is caught', async () => {
  const { items, onInstalled } = setup();
  initMenus();
  await new Promise((r) => setTimeout(r, 30));
  const chromeStorage = (globalThis as unknown as { chrome: { storage: { local: { get: () => Promise<unknown> } } } }).chrome.storage.local;
  chromeStorage.get = async () => { throw new Error('storage gone'); };
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => void unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  const errors = console.error;
  console.error = () => {};
  try {
    (onInstalled[0] as () => void)();
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    process.off('unhandledRejection', onUnhandled);
    console.error = errors;
  }
  assert.deepEqual(unhandled, []);
  assert.equal(items.length, 3, 'the menus built at start stay');
});

test('the dl-menu-click hook ignores fields of the wrong type instead of storing or throwing on them', async () => {
  const { messageListeners, session } = setup();
  initMenus();
  const send = (msg: unknown) => new Promise<unknown>((resolve) => void messageListeners.some((l) => l(msg, { url: `${BASE}options.html` }, resolve)));
  assert.deepEqual(await send({ type: 'dl-menu-click', menuItemId: 'dl-link', linkUrl: 'https://x.com/a.zip', pageUrl: 5, tabId: 1 }), { ok: true });
  assert.deepEqual(session.get('dlPrefill'), { urls: ['https://x.com/a.zip'], referrer: '' }, 'a non-string pageUrl is no referrer');
  assert.deepEqual(await send({ type: 'dl-menu-click', menuItemId: 'dl-selection', selectionText: { toString: 1 }, tabId: 'x' }), { ok: true });
});

test('initMenus registers the click and install listeners and rebuilds when downloads.on changes', async () => {
  const { items, calls, onClicked, onInstalled, onChanged, state } = setup();
  initMenus();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(onClicked.length, 1);
  assert.equal(onInstalled.length, 1);
  assert.equal(items.length, 3); // built once at worker start
  const before = calls.removeAll;
  state.on = false;
  for (const cb of onChanged) cb({ downloads: { newValue: { ...DEFAULT_DOWNLOADS, on: false } } }, 'local');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.removeAll, before + 1);
  assert.equal(items.length, 0);
});

test('a link click stores dlPrefill and opens downloads.html#add', async () => {
  const { session, calls } = setup();
  await onMenuClicked({ menuItemId: 'dl-link', linkUrl: 'https://x.com/a.zip', pageUrl: 'https://x.com/p' }, { id: 1 });
  assert.deepEqual(session.get('dlPrefill'), { urls: ['https://x.com/a.zip'], referrer: 'https://x.com/p' });
  assert.deepEqual(calls.created, [{ url: `${BASE}downloads.html#add` }]);
});

test('javascript: and ftp: links store nothing and open nothing', async () => {
  const { session, calls } = setup();
  await onMenuClicked({ menuItemId: 'dl-link', linkUrl: 'javascript:alert(1)' }, { id: 1 });
  await onMenuClicked({ menuItemId: 'dl-link', linkUrl: 'ftp://x.com/a.zip' }, { id: 1 });
  assert.equal(session.size, 0);
  assert.equal(calls.created.length, 0);
});

test('a selection click scripts the clicked frame and falls back to typed links when nothing is found', async () => {
  const hit = setup({ result: ['https://x.com/1', 'https://x.com/2'] });
  await onMenuClicked({ menuItemId: 'dl-selection', frameId: 3, selectionText: 'https://typed.com/z' }, { id: 7, url: 'https://x.com/p' });
  assert.deepEqual(hit.calls.scripts[0].target, { tabId: 7, frameIds: [3] });
  assert.deepEqual(hit.session.get('dlPrefill'), { urls: ['https://x.com/1', 'https://x.com/2'], referrer: 'https://x.com/p' });
  const miss = setup({ result: [] });
  await onMenuClicked({ menuItemId: 'dl-selection', selectionText: 'see https://skip.me\nhttps://typed.com/z' }, { id: 7 });
  assert.deepEqual(miss.calls.scripts[0].target.frameIds, [0]);
  assert.deepEqual(miss.session.get('dlPrefill'), { urls: ['https://typed.com/z'], referrer: '' });
});

test('a page click stores at most 500 links; a rejected script and a missing tab id store nothing', async () => {
  const many = setup({ result: Array.from({ length: 600 }, (_, i) => `https://a.com/${i}`) });
  await onMenuClicked({ menuItemId: 'dl-page' }, { id: 1 });
  assert.equal((many.session.get('dlPrefill') as { urls: string[] }).urls.length, 500);
  const rej = setup({ reject: true });
  await onMenuClicked({ menuItemId: 'dl-page' }, { id: 1 });
  assert.equal(rej.session.size, 0);
  const noTab = setup({ result: ['https://a.com/1'] });
  await onMenuClicked({ menuItemId: 'dl-page' }, undefined);
  assert.equal(noTab.session.size, 0);
  assert.equal(noTab.calls.scripts.length, 0);
});

test('an existing downloads tab is updated and focused instead of a new one', async () => {
  const { calls } = setup({ tabs: [{ id: 9, windowId: 4 }] });
  await onMenuClicked({ menuItemId: 'dl-link', linkUrl: 'https://x.com/a.zip' }, { id: 1 });
  assert.equal(calls.created.length, 0);
  const [[id, props]] = calls.updated as [[number, { active: boolean; url: string }]];
  assert.equal(id, 9);
  assert.equal(props.active, true);
  assert.match(props.url, /^chrome-extension:\/\/sieve\/downloads\.html\?r=\d+#add$/); // a fresh query forces a real navigation
  assert.deepEqual(calls.windows, [[4, { focused: true }]]);
  assert.deepEqual(calls.reload, []);
});

test('downloads.on false does nothing at all', async () => {
  const { session, calls } = setup({ on: false, result: ['https://a.com/1'] });
  await onMenuClicked({ menuItemId: 'dl-link', linkUrl: 'https://x.com/a.zip' }, { id: 1 });
  await onMenuClicked({ menuItemId: 'dl-page' }, { id: 1 });
  assert.equal(session.size, 0);
  assert.equal(calls.scripts.length + calls.created.length, 0);
});

test('the dl-menu-click hook is refused from a web page and a sender without a url, accepted from an extension page', async () => {
  const { messageListeners, session } = setup();
  initMenus();
  const msg = { type: 'dl-menu-click', menuItemId: 'dl-link', linkUrl: 'https://x.com/a.zip', pageUrl: 'https://x.com/p', tabId: 1 };
  const send = (sender: unknown) =>
    new Promise<unknown>((resolve) => {
      const kept = messageListeners.some((l) => l(msg, sender, resolve));
      if (!kept) resolve('ignored');
    });
  assert.equal(await send({ url: 'https://evil.com/' }), 'ignored');
  assert.equal(await send({}), 'ignored');
  assert.equal(session.size, 0);
  assert.deepEqual(await send({ url: `${BASE}options.html` }), { ok: true });
  assert.equal(session.size, 1);
});

test('collectAll and collectSelected read document.links and the selection', () => {
  const a = (href: string) => ({ href });
  const links = [a('https://a.com/1'), a('https://a.com/2'), a('https://a.com/3')];
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { links };
  assert.deepEqual(collectAll(), links.map((l) => l.href));
  g.getSelection = () => ({ rangeCount: 1, containsNode: (n: unknown) => n !== links[1] });
  assert.deepEqual(collectSelected(), ['https://a.com/1', 'https://a.com/3']);
  g.getSelection = () => ({ rangeCount: 0, containsNode: () => true });
  assert.deepEqual(collectSelected(), []);
  delete g.document;
  delete g.getSelection;
});
