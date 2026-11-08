import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { onPanelConnect } from '../panels.ts';

const feature = (ruleset: string | null, allowIds: number[] = [], modifyIds: number[] = []) => ({ ruleset, ruleCount: 10, hasGenericCss: false, genericExcept: [], allowIds, modifyIds });
const meta: BuildMeta = {
  builtAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 10,
  features: { ads: feature('ads', [7]), trackers: feature('trackers'), distraction: feature('distraction'), cookies: feature('cookies'), antiadblock: feature('antiadblock', [], [5]), ai: feature(null) },
  scriptlets: [],
};

// A fresh copy of counts.ts per test (it caches meta.json at module level), run against an in-memory `chrome`.
let n = 0;
async function setup(options: { badgeFails?: boolean; fetchFailures?: number; dynamic?: { id: number; action: { type: string; redirect?: object } }[] } = {}) {
  const store = new Map<string, unknown>();
  const badges = new Map<number, string>();
  const logged: unknown[][] = [];
  let fetches = 0;
  let badgeCalls = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  g.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` },
    declarativeNetRequest: { getDynamicRules: async ({ ruleIds }: { ruleIds: number[] }) => (options.dynamic ?? []).filter((r) => ruleIds.includes(r.id)) },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => {
        badgeCalls++;
        if (options.badgeFails) throw new Error(`No tab with id: ${tabId}.`);
        badges.set(tabId, text);
      },
    },
    storage: {
      session: {
        get: async (key: string) => {
          await sleep(2);
          return store.has(key) ? { [key]: structuredClone(store.get(key)) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          await sleep(2);
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
        remove: async (key: string) => void store.delete(key),
      },
    },
  };
  g.fetch = async () => {
    if (fetches++ < (options.fetchFailures ?? 0)) throw new TypeError('Failed to fetch');
    return { json: async () => meta };
  };
  console.error = (...args: unknown[]) => void logged.push(args);
  const counts = (await import(`../counts.ts?fresh=${++n}`)) as typeof import('../counts.ts');
  const match = (tabId: number, rulesetId: string, ruleId: number) =>
    counts.onMatched({ request: { tabId, url: `https://x.example/${rulesetId}/${ruleId}.js`, type: 'script' }, rule: { rulesetId, ruleId } } as chrome.declarativeNetRequest.MatchedRuleInfoDebug);
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await sleep(5);
    assert.ok(done(), 'timed out');
  };
  return { counts, store, badges, logged, match, until, badgeCalls: () => badgeCalls };
}

test('an ad and a tracker are counted per tab and the badge shows the total; allow and header-only rules are not counted', async () => {
  const t = await setup();
  t.match(1, 'ads', 1);
  t.match(1, 'ads', 7);
  t.match(1, 'antiadblock', 5);
  t.match(1, 'trackers', 1);
  t.match(2, 'ads', 2);
  t.match(-1, 'ads', 3);
  await t.until(() => t.badges.get(1) === '2' && t.badges.get(2) === '1' && t.store.size === 2);
  assert.deepEqual(t.store.get('counts:1'), { ads: 1, trackers: 1 });
  assert.deepEqual(t.store.get('counts:2'), { ads: 1, trackers: 0 });
});

test('a My filters rule is counted only when it blocks: its allow, header-only and $removeparam rules are not', async () => {
  const dynamic = [
    { id: 1, action: { type: 'block' } },
    { id: 2, action: { type: 'modifyHeaders' } },
    { id: 3, action: { type: 'allow' } },
    { id: 4, action: { type: 'allowAllRequests' } },
    { id: 5, action: { type: 'upgradeScheme' } },
    { id: 6, action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } } } },
    { id: 7, action: { type: 'redirect', redirect: { extensionPath: '/blank.js' } } },
  ];
  const t = await setup({ dynamic });
  for (const r of dynamic) t.match(1, '_dynamic', r.id);
  t.match(1, 'trackers', 9);
  await t.until(() => t.badges.get(1) === '3');
  await sleep(30);
  assert.deepEqual(t.store.get('counts:1'), { ads: 2, trackers: 1 });
});

test('events that arrive together are all counted', async () => {
  const t = await setup();
  for (let i = 0; i < 6; i++) t.match(1, 'ads', i + 100);
  await t.until(() => (t.store.get('counts:1') as { ads: number } | undefined)?.ads === 6);
  assert.equal(t.badges.get(1), '6');
  assert.deepEqual(t.store.get('counts:1'), { ads: 6, trackers: 0 });
});

test('a main-frame navigation resets the tab, a frame navigation does not, and closing the tab deletes its counts', async () => {
  const t = await setup();
  t.match(1, 'ads', 1);
  await t.until(() => t.badges.get(1) === '1' && t.store.has('counts:1'));
  t.counts.onNavigated({ tabId: 1, frameId: 4 } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  t.match(1, 'ads', 2);
  await t.until(() => t.badges.get(1) === '2' && (t.store.get('counts:1') as { ads: number }).ads === 2);
  t.counts.onNavigated({ tabId: 1, frameId: 0 } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  await t.until(() => t.badges.get(1) === '' && !t.store.has('counts:1'));
  t.match(1, 'ads', 3);
  await t.until(() => t.badges.get(1) === '1' && t.store.has('counts:1'));
  t.counts.onTabRemoved(1);
  await t.until(() => !t.store.has('counts:1'));
});

test('a count that arrives after its tab closed leaves no entry behind, and is not logged as an error', async () => {
  const t = await setup({ badgeFails: true });
  t.match(1, 'ads', 1);
  await t.until(() => t.badgeCalls() > 0);
  await sleep(30);
  assert.equal(t.store.size, 0);
  assert.deepEqual(t.logged, []);
});

test('a failed meta.json fetch is logged once and tried again by the next event', async () => {
  const t = await setup({ fetchFailures: 1 });
  t.match(1, 'ads', 1);
  await t.until(() => t.logged.length === 1);
  t.match(1, 'ads', 2);
  await t.until(() => t.store.has('counts:1'));
  assert.equal(t.badges.get(1), '1');
  assert.deepEqual(t.store.get('counts:1'), { ads: 1, trackers: 0 });
  assert.equal(t.logged.length, 1);
});

// A panel's port as the worker sees it; `postMessage` can be made to fail, as it does once the panel is gone.
function panel(tabId: number, options: { fails?: boolean } = {}) {
  const sent: Record<string, unknown>[] = [];
  const port = {
    name: `panel:${tabId}`,
    sender: { url: 'chrome-extension://sieve/panel.html' },
    postMessage: (m: Record<string, unknown>) => {
      if (options.fails) throw new Error('Attempting to use a disconnected port object');
      sent.push(m);
    },
    disconnect: () => {},
    onDisconnect: { addListener: () => {} },
  };
  onPanelConnect(port as unknown as chrome.runtime.Port);
  return sent;
}

test("a counted match is forwarded to its tab's panel with its rule; allow, header-only and other tabs' matches are not", async () => {
  const t = await setup({ dynamic: [{ id: 3, action: { type: 'allow' } }, { id: 4, action: { type: 'block' } }] });
  const sent = panel(61);
  t.match(61, 'ads', 1);
  t.match(61, 'ads', 7);
  t.match(61, 'antiadblock', 5);
  t.match(61, '_dynamic', 3);
  t.match(62, 'ads', 2);
  t.match(61, '_dynamic', 4);
  t.match(61, 'trackers', 9);
  await t.until(() => t.badges.get(61) === '3' && sent.length === 3);
  assert.deepEqual(
    sent.map((m) => ({ ...m, at: typeof m.at })),
    [
      { url: 'https://x.example/ads/1.js', type: 'script', rulesetId: 'ads', ruleId: 1, at: 'number' },
      { url: 'https://x.example/_dynamic/4.js', type: 'script', rulesetId: '_dynamic', ruleId: 4, at: 'number' },
      { url: 'https://x.example/trackers/9.js', type: 'script', rulesetId: 'trackers', ruleId: 9, at: 'number' },
    ],
  );
});

test('a panel that cannot be written to does not cost a count or the badge', async () => {
  const t = await setup();
  panel(63, { fails: true });
  t.match(63, 'ads', 1);
  t.match(63, 'trackers', 2);
  await t.until(() => t.badges.get(63) === '2' && (t.store.get('counts:63') as { trackers: number } | undefined)?.trackers === 1);
  assert.deepEqual(t.store.get('counts:63'), { ads: 1, trackers: 1 });
  assert.deepEqual(t.logged, []);
});

test('a match whose forwarding throws while the message is built is still counted', async () => {
  const t = await setup();
  panel(66);
  const request = { tabId: 66, type: 'script', get url(): string { throw new Error('unreadable'); } };
  t.counts.onMatched({ request, rule: { rulesetId: 'ads', ruleId: 1 } } as unknown as chrome.declarativeNetRequest.MatchedRuleInfoDebug);
  await t.until(() => t.badges.get(66) === '1' && t.store.has('counts:66'));
  assert.deepEqual(t.store.get('counts:66'), { ads: 1, trackers: 0 });
  assert.equal(t.logged.length, 1);
});

test('a main-frame navigation tells the panel to clear, in order with the matches around it; a frame navigation does not', async () => {
  const t = await setup();
  const sent = panel(64);
  t.match(64, 'ads', 1);
  t.counts.onNavigated({ tabId: 64, frameId: 3 } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  t.counts.onNavigated({ tabId: 64, frameId: 0 } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  t.match(64, 'ads', 2);
  await t.until(() => sent.length === 3);
  assert.deepEqual(
    sent.map((m) => ('reset' in m ? 'reset' : m.ruleId)),
    [1, 'reset', 2],
  );
});
