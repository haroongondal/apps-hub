import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_SETTINGS } from '@apps-hub/sieve-core/src/settings.ts';

type Reply = { ok: boolean };
type Css = { target: { tabId: number; documentIds: string[] }; css: string; origin: string };

// A fresh copy of pick-handler.ts per test, run against an in-memory `chrome`; the settings lock (lock.ts) is shared by every copy.
let n = 0;
async function setup(options: { cssFails?: boolean } = {}) {
  const store = new Map<string, unknown>([['settings', structuredClone(DEFAULT_SETTINGS)]]);
  const inserted: Css[] = [];
  const logged: unknown[][] = [];
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      local: {
        // Slow reads and writes, so two picks that overlap would lose one.
        get: async (keys: string[]) => {
          await sleep(3);
          return Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
        },
        set: async (items: Record<string, unknown>) => {
          await sleep(3);
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
    },
    scripting: {
      insertCSS: async (css: Css) => {
        if (options.cssFails) throw new Error('No tab with id: 7.');
        inserted.push(css);
      },
    },
  };
  console.error = (...args: unknown[]) => void logged.push(args);
  const { onMessage } = (await import(`../pick-handler.ts?fresh=${++n}`)) as typeof import('../pick-handler.ts');
  const send = (message: unknown, sender: Partial<chrome.runtime.MessageSender> = {}) =>
    new Promise<{ handled: boolean; reply?: Reply }>((resolve) => {
      const full = { url: 'https://www.example.com/shop', tab: { id: 7 }, documentId: 'doc-1', ...sender } as chrome.runtime.MessageSender;
      let reply: Reply | undefined;
      const keepsOpen = onMessage(message, full, (r) => {
        reply = r;
        resolve({ handled: true, reply });
      });
      if (!keepsOpen) resolve({ handled: reply !== undefined, reply });
    });
  const blocking = () => (store.get('settings') as typeof DEFAULT_SETTINGS).blocking;
  return { store, inserted, logged, send, blocking, hide: () => (store.get('myCosmetic') as { hide: Record<string, string[]> } | undefined)?.hide };
}

const pick = (selector: string, host = 'www.example.com') => ({ type: 'pick', host, selector });

test('a pick adds a hide filter, one entry in My filters cosmetic data, and CSS in that very document', async () => {
  const t = await setup();
  const { reply } = await t.send(pick('div.wrap > a.promo'));
  assert.deepEqual(reply, { ok: true });
  assert.equal(t.blocking().myFilters, 'www.example.com##div.wrap > a.promo');
  assert.deepEqual(t.hide(), { 'www.example.com': ['div.wrap > a.promo'] });
  assert.deepEqual(t.inserted, [{ target: { tabId: 7, documentIds: ['doc-1'] }, css: 'div.wrap > a.promo{display:none!important}', origin: 'USER' }]);
  assert.equal(t.blocking().lists.ads, true, 'the other settings are kept');
});

test('picks add to what is there: other filters, other hosts, and no repeat of the same selector', async () => {
  const t = await setup();
  t.store.set('settings', { ...DEFAULT_SETTINGS, blocking: { ...DEFAULT_SETTINGS.blocking, myFilters: '||ads.example^\n', allowlist: [{ kind: 'site', host: 'kept.com' }] } });
  t.store.set('myCosmetic', { hide: { 'other.com': ['.x'] }, unhide: { 'other.com': ['.y'] } });
  await t.send(pick('div.a'));
  await t.send(pick('div.b'));
  await t.send(pick('div.a'));
  assert.equal(t.blocking().myFilters, '||ads.example^\nwww.example.com##div.a\nwww.example.com##div.b');
  assert.deepEqual(t.blocking().allowlist, [{ kind: 'site', host: 'kept.com' }]);
  const mine = t.store.get('myCosmetic') as { hide: unknown; unhide: unknown };
  assert.deepEqual(mine.hide, { 'other.com': ['.x'], 'www.example.com': ['div.a', 'div.b'] });
  assert.deepEqual(mine.unhide, { 'other.com': ['.y'] });
});

test('two picks sent at the same moment are both saved', async () => {
  const t = await setup();
  const replies = await Promise.all([t.send(pick('div.a')), t.send(pick('div.b'), { documentId: 'doc-2' }), t.send(pick('div.c'))]);
  assert.deepEqual(replies.map((r) => r.reply), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(t.blocking().myFilters, 'www.example.com##div.a\nwww.example.com##div.b\nwww.example.com##div.c');
  assert.deepEqual(t.hide(), { 'www.example.com': ['div.a', 'div.b', 'div.c'] });
  assert.deepEqual(t.inserted.map((i) => i.target.documentIds[0]), ['doc-1', 'doc-2', 'doc-1']);
});

test('the host is the sender page, whatever the message says, and a www. host stays apart from its siblings', async () => {
  const t = await setup();
  await t.send(pick('div.a', 'evil.com'), { url: 'http://shop.example.org:8080/x' });
  assert.equal(t.blocking().myFilters, 'shop.example.org##div.a');
  assert.deepEqual(t.hide(), { 'shop.example.org': ['div.a'] });
  await t.send(pick('div.b'), { url: 'https://www.google.com/' });
  await t.send(pick('div.c'), { url: 'https://mail.google.com/' });
  assert.deepEqual(t.hide(), { 'shop.example.org': ['div.a'], 'www.google.com': ['div.b'], 'mail.google.com': ['div.c'] });
});

test('a pick that does not come from a web page, or is not what the picker builds, changes nothing and gets "not ok"', async () => {
  const t = await setup();
  const bad: [unknown, Partial<chrome.runtime.MessageSender>][] = [
    [pick('div.a'), { url: 'chrome-extension://abc/popup.html' }],
    [pick('div.a'), { url: 'http://[::1]/' }],
    [pick('div.a'), { tab: undefined }],
    [pick('div.a'), { documentId: undefined }],
    [pick('div.a\nexample.com#%#//scriptlet("x")'), {}],
    [pick('div.a, body'), {}],
    [pick('div.a{}'), {}],
    [pick('div'), {}],
    [pick('html'), {}],
    [pick('div.a:not('), {}],
    [{ type: 'pick', host: 'x' }, {}],
  ];
  for (const [message, sender] of bad) assert.deepEqual((await t.send(message, sender)).reply, { ok: false }, JSON.stringify([message, sender]));
  assert.equal(t.blocking().myFilters, '');
  assert.equal(t.hide(), undefined);
  assert.deepEqual(t.inserted, []);
});

test('a message that is not a pick is left for other listeners', async () => {
  const t = await setup();
  for (const message of [{ type: 'other' }, null, undefined, 'pick', 5]) assert.deepEqual(await t.send(message), { handled: false, reply: undefined });
});

test('when the CSS cannot be inserted, the pick says "not ok", is already stored, and a second try adds nothing twice', async () => {
  const t = await setup({ cssFails: true });
  assert.deepEqual((await t.send(pick('div.a'))).reply, { ok: false });
  assert.equal(t.logged.length, 1);
  assert.equal(t.blocking().myFilters, 'www.example.com##div.a');
  await t.send(pick('div.a'));
  assert.equal(t.blocking().myFilters, 'www.example.com##div.a');
  assert.deepEqual(t.hide(), { 'www.example.com': ['div.a'] });
});

test('one failed pick does not hold up the next', async () => {
  const t = await setup();
  const first = t.send(pick('div.a'), { documentId: undefined });
  const second = t.send(pick('div.b'));
  assert.deepEqual((await first).reply, { ok: false });
  assert.deepEqual((await second).reply, { ok: true });
  assert.equal(t.blocking().myFilters, 'www.example.com##div.b');
});
