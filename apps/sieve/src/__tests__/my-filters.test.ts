import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { DEFAULT_SETTINGS, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { FILTERS_CHANGED, saveMyFilters } from '../my-filters.ts';

const feature = (ruleset: string | null) => ({ ruleset, ruleCount: 10, hasGenericCss: false, genericExcept: [], allowIds: [], modifyIds: [] });
const meta: BuildMeta = {
  builtAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 10,
  features: { ads: feature('ads'), trackers: feature('trackers'), distraction: feature('distraction'), cookies: feature('cookies'), antiadblock: feature('antiadblock'), ai: feature(null) },
  scriptlets: ['set-constant', 'trusted-set-cookie'],
};
type Rule = { id: number; action: { type: string } };
const OLD_RULE: Rule = { id: 1, action: { type: 'block' } };

// An in-memory `chrome` with one earlier My filters rule applied, and Chrome refusing any update when `refuse` is set.
function setup(settings: Settings, refuse?: string) {
  const store = new Map<string, unknown>([['settings', structuredClone(settings)], ['myRules', [OLD_RULE]]]);
  let dynamic: Rule[] = [OLD_RULE];
  const updates: { removeRuleIds?: number[]; addRules?: Rule[] }[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` },
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))])),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => structuredClone(dynamic),
      updateDynamicRules: async (u: { removeRuleIds?: number[]; addRules?: Rule[] }) => {
        updates.push(u);
        if (refuse) throw new Error(refuse);
        dynamic = [...dynamic.filter((r) => !u.removeRuleIds?.includes(r.id)), ...(u.addRules ?? [])];
      },
    },
  };
  g.fetch = async () => ({ json: async () => meta });
  return { store, updates, dynamic: () => dynamic };
}

const withAllowlist: Settings = { ...DEFAULT_SETTINGS, blocking: { ...DEFAULT_SETTINGS.blocking, myFilters: 'old', allowlist: [{ kind: 'site', host: 'example.com' }] } };

test('valid lines are saved and applied with the allow rules in one call that replaces every earlier rule; bad lines come back by line number', async () => {
  const t = setup(withAllowlist);
  const text = "||ads.example^\nnot a filter ##\nexample.com#%#//scriptlet('trusted-set-cookie', 'a', 'b')\n! a comment\n";
  const out = await saveMyFilters(text);
  assert.equal(out.saved, 2);
  assert.deepEqual(out.errors, [{ line: 2, text: 'not a filter ##', reason: "Sieve can't read this line as a filter. Check it for typos and stray spaces." }]);
  assert.equal(t.updates.length, 1);
  assert.deepEqual(t.updates[0].removeRuleIds, [1]);
  assert.deepEqual(t.updates[0].addRules?.map((r) => [r.id, r.action.type]), [
    [1, 'block'],
    [1_000_000, 'allowAllRequests'],
  ]);
  const saved = (t.store.get('settings') as Settings).blocking;
  assert.equal(saved.myFilters, text);
  assert.deepEqual(saved.allowlist, withAllowlist.blocking.allowlist);
  assert.equal((t.store.get('myRules') as Rule[]).length, 1);
  assert.deepEqual(t.store.get('myRuleSources'), { 1: '||ads.example^' });
  // My filters are the owner's own, so a trusted-* scriptlet the build ships is kept.
  assert.deepEqual((t.store.get('myCosmetic') as { scriptlets: unknown }).scriptlets, { 'example.com': [{ name: 'trusted-set-cookie', args: ['a', 'b'] }] });
});

test('when Chrome refuses the rules, nothing is stored, the earlier rules stay, and Chrome says why on line 0', async () => {
  const t = setup(withAllowlist, 'Dynamic rule count exceeded.');
  const out = await saveMyFilters('||a.example^\n||b.example^');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: 'Dynamic rule count exceeded.' }] });
  assert.equal(t.updates.length, 1);
  assert.deepEqual(t.dynamic(), [OLD_RULE]);
  assert.equal((t.store.get('settings') as Settings).blocking.myFilters, 'old');
  assert.deepEqual(t.store.get('myRules'), [OLD_RULE]);
  assert.equal(t.store.has('myCosmetic'), false);
});

test('when the stored filters moved on from the text the edit started from, nothing is applied or saved', async () => {
  const t = setup(withAllowlist);
  const out = await saveMyFilters('||a.example^', 'what the page loaded');
  assert.deepEqual(out, { saved: 0, errors: [{ line: 0, text: '', reason: FILTERS_CHANGED }] });
  assert.equal(t.updates.length, 0);
  assert.equal((t.store.get('settings') as Settings).blocking.myFilters, 'old');
});

test('while paused, the rules are checked as if unpaused, saved, then taken off again', async () => {
  const t = setup({ ...withAllowlist, blocking: { ...withAllowlist.blocking, paused: true } });
  const out = await saveMyFilters('||a.example^', 'old');
  assert.equal(out.saved, 1);
  assert.equal(t.updates[0].addRules?.length, 2);
  assert.deepEqual(t.dynamic(), []);
  assert.equal((t.store.get('settings') as Settings).blocking.myFilters, '||a.example^');
});
