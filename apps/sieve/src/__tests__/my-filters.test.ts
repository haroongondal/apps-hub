import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { DEFAULT_SETTINGS, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { FILTERS_CHANGED, TOO_MANY_TO_STORE, saveMyFilters } from '../my-filters.ts';
import { onMessage } from '../pick-handler.ts';

const feature = (ruleset: string | null) => ({ ruleset, ruleCount: 10, hasGenericCss: false, genericExcept: [], allowIds: [], modifyIds: [] });
const meta: BuildMeta = {
  builtAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 10,
  features: { ads: feature('ads'), trackers: feature('trackers'), distraction: feature('distraction'), cookies: feature('cookies'), antiadblock: feature('antiadblock'), ai: feature(null) },
  scriptlets: ['set-constant', 'trusted-set-cookie'],
};
type Rule = { id: number; action: { type: string } };
type Update = { removeRuleIds?: number[]; addRules?: Rule[] };
const OLD_RULE: Rule = { id: 1, action: { type: 'block' } };

// An in-memory `chrome` with one earlier My filters rule applied. `refuse`: Chrome refuses any update; `setFails`: storage
// refuses writes; `restoreFails`: Chrome refuses the second update, the one that puts the earlier rules back; `onApply`: runs as
// Chrome starts taking the rules, which is slow.
function setup(settings: Settings, options: { refuse?: string; setFails?: boolean; restoreFails?: boolean; onApply?: () => void } = {}) {
  const store = new Map<string, unknown>([['settings', structuredClone(settings)], ['myRules', [OLD_RULE]]]);
  let dynamic: Rule[] = [OLD_RULE];
  const updates: Update[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          await sleep(1);
          return Object.fromEntries([keys].flat().filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
        },
        set: async (items: Record<string, unknown>) => {
          await sleep(1);
          if (options.setFails) throw new Error('QUOTA_BYTES quota exceeded');
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(dynamic),
      updateDynamicRules: async (u: Update) => {
        updates.push(u);
        if (options.refuse) throw new Error(options.refuse);
        if (options.restoreFails && updates.length === 2) throw new Error('Chrome is not answering');
        if (updates.length === 1) options.onApply?.();
        await sleep(20);
        dynamic = [...dynamic.filter((r) => !u.removeRuleIds?.includes(r.id)), ...(u.addRules ?? [])];
      },
    },
    scripting: { insertCSS: async () => {} },
  };
  g.fetch = async () => ({ json: async () => meta });
  return { store, updates, dynamic: () => dynamic, settings: () => store.get('settings') as Settings };
}

const pickFromPage = (selector: string) =>
  new Promise<unknown>((resolve) =>
    onMessage({ type: 'pick', host: 'www.example.com', selector }, { url: 'https://www.example.com/', tab: { id: 7 }, documentId: 'doc-1' } as chrome.runtime.MessageSender, resolve),
  );

const withAllowlist: Settings = { ...DEFAULT_SETTINGS, blocking: { ...DEFAULT_SETTINGS.blocking, myFilters: 'old', allowlist: [{ kind: 'site', host: 'example.com' }] } };

test('valid lines are saved and applied with the allow rules in one call that replaces every earlier rule; bad lines come back by line number', async () => {
  const t = setup(withAllowlist);
  const text = "||ads.example^\nnot a filter ##\nexample.com#%#//scriptlet('trusted-set-cookie', 'a', 'b')\n! a comment\n";
  const out = await saveMyFilters(text);
  assert.equal(out.saved, 2);
  assert.equal(out.notSaved, undefined);
  assert.deepEqual(out.errors, [{ line: 2, text: 'not a filter ##', reason: "Sieve can't read this line as a filter. Check it for typos and stray spaces." }]);
  assert.equal(t.updates.length, 1);
  assert.deepEqual(t.updates[0].removeRuleIds, [1]);
  assert.deepEqual(t.updates[0].addRules?.map((r) => [r.id, r.action.type]), [
    [1, 'block'],
    [1_000_000, 'allowAllRequests'],
  ]);
  assert.equal(t.settings().blocking.myFilters, text);
  assert.deepEqual(t.settings().blocking.allowlist, withAllowlist.blocking.allowlist);
  assert.equal((t.store.get('myRules') as Rule[]).length, 1);
  assert.deepEqual(t.store.get('myRuleSources'), { 1: '||ads.example^' });
  // My filters are the owner's own, so a trusted-* scriptlet the build ships is kept.
  assert.deepEqual((t.store.get('myCosmetic') as { scriptlets: unknown }).scriptlets, { 'example.com': [{ name: 'trusted-set-cookie', args: ['a', 'b'] }] });
});

test('when Chrome refuses the rules, nothing is stored, the earlier rules stay, and Chrome says why on line 0', async () => {
  const t = setup(withAllowlist, { refuse: 'Dynamic rule count exceeded.' });
  const out = await saveMyFilters('||a.example^\n||b.example^');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: 'Dynamic rule count exceeded.' }], notSaved: 'Dynamic rule count exceeded.' });
  assert.equal(t.updates.length, 1);
  assert.deepEqual(t.dynamic(), [OLD_RULE]);
  assert.equal(t.settings().blocking.myFilters, 'old');
  assert.deepEqual(t.store.get('myRules'), [OLD_RULE]);
  assert.equal(t.store.has('myCosmetic'), false);
});

test('when storage refuses the write, the rules Chrome took are swapped back for the earlier ones, and nothing is stored', async () => {
  const t = setup(withAllowlist, { setFails: true });
  const out = await saveMyFilters('||a.example^\n||b.example^', 'old');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: TOO_MANY_TO_STORE }], notSaved: TOO_MANY_TO_STORE });
  assert.equal(t.updates.length, 2);
  assert.deepEqual(t.updates[1], { removeRuleIds: [1, 2, 1_000_000], addRules: [OLD_RULE] });
  assert.deepEqual(t.dynamic(), [OLD_RULE]);
  assert.equal(t.settings().blocking.myFilters, 'old');
  assert.deepEqual(t.store.get('myRules'), [OLD_RULE]);
});

test('when storage refuses the write and Chrome then fails to take the earlier rules back, the save still says nothing was stored', async () => {
  const t = setup(withAllowlist, { setFails: true, restoreFails: true });
  const out = await saveMyFilters('||a.example^\n||b.example^', 'old');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: TOO_MANY_TO_STORE }], notSaved: TOO_MANY_TO_STORE });
  assert.equal(t.updates.length, 2, 'the restore was tried once');
  // Chrome keeps the new rules until the worker's next apply rebuilds them from storage, which still holds the earlier ones.
  assert.equal(t.settings().blocking.myFilters, 'old');
  assert.deepEqual(t.store.get('myRules'), [OLD_RULE]);
});

test('when the stored filters moved on from the text the edit started from, nothing is applied or saved', async () => {
  const t = setup(withAllowlist);
  const out = await saveMyFilters('||a.example^', 'what the page loaded');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: FILTERS_CHANGED }], notSaved: FILTERS_CHANGED });
  assert.equal(t.updates.length, 0);
  assert.equal(t.settings().blocking.myFilters, 'old');
});

test('a pick that arrives while Chrome takes the saved rules waits, then adds to the saved filters: neither is lost', async () => {
  let picked: Promise<unknown> = Promise.resolve();
  const t = setup(withAllowlist, { onApply: () => (picked = pickFromPage('div.promo')) });
  const out = await saveMyFilters('||a.example^', 'old');
  assert.deepEqual(await picked, { ok: true });
  assert.equal(out.saved, 1);
  assert.equal(t.settings().blocking.myFilters, '||a.example^\nwww.example.com##div.promo');
  assert.deepEqual((t.store.get('myCosmetic') as { hide: unknown }).hide, { 'www.example.com': ['div.promo'] });
  assert.equal((t.store.get('myRules') as Rule[]).length, 1);
});

test('a pick saved before the save takes the lock makes the save stop with FILTERS_CHANGED, and the pick stays', async () => {
  const t = setup(withAllowlist);
  const picked = pickFromPage('div.promo');
  const out = await saveMyFilters('||a.example^', 'old');
  assert.deepEqual(await picked, { ok: true });
  assert.equal(out.notSaved, FILTERS_CHANGED);
  assert.equal(t.updates.length, 0);
  assert.equal(t.settings().blocking.myFilters, 'old\nwww.example.com##div.promo');
});

test('while paused, the rules are checked as if unpaused, saved, then taken off again', async () => {
  const t = setup({ ...withAllowlist, blocking: { ...withAllowlist.blocking, paused: true } });
  const out = await saveMyFilters('||a.example^', 'old');
  assert.equal(out.saved, 1);
  assert.equal(t.updates[0].addRules?.length, 2);
  assert.deepEqual(t.dynamic(), []);
  assert.equal(t.settings().blocking.myFilters, '||a.example^');
});
