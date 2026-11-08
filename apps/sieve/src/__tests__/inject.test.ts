import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import type { BuildMeta } from '@apps-hub/sieve-core/src/plan.ts';
import { DEFAULT_SETTINGS } from '@apps-hub/sieve-core/src/settings.ts';

// inject.ts imports the build's generated scriptlets.js, which src/ does not have: Node gets an empty one.
register(
  `data:text/javascript,${encodeURIComponent(
    "export async function resolve(s, c, next) { return s === './scriptlets.js' ? { url: 'data:text/javascript,export const SCRIPTLETS = {}', shortCircuit: true } : next(s, c); }",
  )}`,
);

const feature = { ruleset: null, ruleCount: 0, hasGenericCss: false, genericExcept: [], allowIds: [], modifyIds: [] };
const meta: BuildMeta = {
  listsAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 1,
  features: { ads: feature, trackers: feature, distraction: feature, cookies: feature, antiadblock: feature, ai: feature },
  scriptlets: [],
};
const cosmetic = { hide: { 'example.com': ['.ad'] }, unhide: {}, generichide: [], elemhide: [], scriptlets: {}, scriptletExcept: {} };

// A fresh copy of inject.ts per test (it caches files and settings at module level), run against an in-memory `chrome`.
let n = 0;
async function setup(fail: { fetch?: number; storage?: number }) {
  const css: string[] = [];
  const logged: unknown[][] = [];
  let fetches = 0;
  let reads = 0;
  const g = globalThis as unknown as Record<string, unknown>;
  g.chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://sieve/${path}` },
    storage: {
      local: {
        get: async () => {
          if (reads++ < (fail.storage ?? 0)) throw new Error('storage is not ready');
          return { settings: DEFAULT_SETTINGS };
        },
      },
    },
    scripting: { insertCSS: async (i: { css: string }) => void css.push(i.css), executeScript: async () => {} },
  };
  g.fetch = async (url: string) => {
    if (fetches++ < (fail.fetch ?? 0)) throw new TypeError('Failed to fetch');
    return { json: async () => (url.endsWith('meta.json') ? meta : cosmetic) };
  };
  console.error = (...args: unknown[]) => void logged.push(args);
  const inject = (await import(`../inject.ts?fresh=${++n}`)) as typeof import('../inject.ts');
  const commit = (doc: string) => inject.onCommitted({ tabId: 1, frameId: 0, documentId: doc, url: 'https://www.example.com/', parentDocumentId: undefined } as unknown as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
  return { css, logged, commit };
}

test('a file that failed to load (a build was rewriting dist) is fetched again for the next page, not failed forever', async () => {
  const error = console.error;
  try {
    const t = await setup({ fetch: 1 });
    await t.commit('doc-1');
    assert.deepEqual(t.css, []);
    assert.ok(t.logged.some((l) => /Failed to fetch/.test(String(l[1]))), 'the failure is reported');
    await t.commit('doc-2');
    assert.deepEqual(t.css, ['.ad{display:none!important}']);
  } finally {
    console.error = error;
  }
});

test('settings that failed to load are read again for the next page', async () => {
  const error = console.error;
  try {
    const t = await setup({ storage: 1 });
    await t.commit('doc-1');
    assert.deepEqual(t.css, []);
    await t.commit('doc-2');
    assert.deepEqual(t.css, ['.ad{display:none!important}']);
  } finally {
    console.error = error;
  }
});
