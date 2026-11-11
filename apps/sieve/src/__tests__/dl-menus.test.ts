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
  (globalThis as unknown as Record<string, unknown>).chrome = {
    contextMenus: {
      removeAll: async () => {
        calls.removeAll++;
        log.push('remove-start');
        await new Promise((r) => setTimeout(r, 2));
        items.length = 0;
        log.push('remove-end');
      },
      create: (item: { id: string; title: string; contexts: string[] }) => {
        log.push('create');
        items.push(item);
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
      local: { get: async () => ({ downloads: { ...DEFAULT_DOWNLOADS, on: options.on ?? true } }) },
      session: { set: async (o: Record<string, unknown>) => void Object.entries(o).forEach(([k, v]) => session.set(k, v)) },
      onChanged: { addListener: (cb: (typeof onChanged)[number]) => void onChanged.push(cb) },
    },
    tabs: {
      query: async () => options.tabs ?? [],
      create: async (p: { url: string }) => void calls.created.push(p),
      update: async (...a: unknown[]) => void calls.updated.push(a),
      reload: async (id: number) => void calls.reload.push(id),
    },
    windows: { update: async (...a: unknown[]) => void calls.windows.push(a) },
    runtime: { getURL: (p: string) => BASE + p, onInstalled: { addListener: (cb: unknown) => void onInstalled.push(cb) }, onMessage: { addListener: (cb: Msg) => void messageListeners.push(cb) } },
  };
  return { items, calls, session, messageListeners, log, onClicked, onInstalled, onChanged };
}

test('normaliseLinks keeps http(s), normalises, deduplicates and caps', () => {
  assert.deepEqual(normaliseLinks(['https://a.com/x', 'https://a.com/x', 'ftp://b', 'mailto:c@d', 'http://e.org', '', 'not a url']), ['https://a.com/x', 'http://e.org/']);
  assert.equal(normaliseLinks(Array.from({ length: 600 }, (_, i) => `https://a.com/${i}`)).length, 500);
  assert.equal(normaliseLinks(['https://a.com/1', 'https://a.com/2', 'https://a.com/3'], 2).length, 2);
});

test('rebuildMenus removes all first, creates three items when on, none when off, and is idempotent', async () => {
  const { items, calls } = setup();
  await rebuildMenus({ ...DEFAULT_DOWNLOADS, on: true });
  assert.equal(calls.removeAll, 1);
  assert.deepEqual(items, [
    { id: 'dl-link', title: T.ctxLink, contexts: ['link'] },
    { id: 'dl-selection', title: T.ctxSelection, contexts: ['selection'] },
    { id: 'dl-page', title: T.ctxPage, contexts: ['page', 'frame'] },
  ]);
  await Promise.all([rebuildMenus({ ...DEFAULT_DOWNLOADS, on: true }), rebuildMenus({ ...DEFAULT_DOWNLOADS, on: true })]);
  assert.equal(items.length, 3);
  await rebuildMenus({ ...DEFAULT_DOWNLOADS, on: false });
  assert.equal(items.length, 0);
});

test('overlapping rebuilds run one after the other and leave exactly three items', async () => {
  const { items, log } = setup();
  const on = { ...DEFAULT_DOWNLOADS, on: true };
  await Promise.all([rebuildMenus(on), rebuildMenus(on)]);
  const one = ['remove-start', 'remove-end', 'create', 'create', 'create'];
  assert.deepEqual(log, [...one, ...one]);
  assert.equal(items.length, 3);
});

test('initMenus registers the click and install listeners and rebuilds when downloads.on changes', async () => {
  const { items, calls, onClicked, onInstalled, onChanged } = setup();
  initMenus();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(onClicked.length, 1);
  assert.equal(onInstalled.length, 1);
  assert.equal(items.length, 3); // built once at worker start
  const before = calls.removeAll;
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
  assert.deepEqual(calls.updated, [[9, { active: true, url: `${BASE}downloads.html#add` }]]);
  assert.deepEqual(calls.windows, [[4, { focused: true }]]);
  assert.deepEqual(calls.reload, [9]); // the fragment alone would not make the page read the new prefill
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
