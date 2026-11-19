import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type Settings } from '@apps-hub/sieve-core/src/settings.ts';
import { count, errorText, setList } from '../controls.ts';

const MAKE_ROOM = 'Turn a list off in Settings to make room.';
const GENERAL = 'Open Settings and check My filters, or reload Sieve from chrome://extensions.';

test('the error banner says "turn a list off" only for Chrome static rule limits, and general advice for anything else', () => {
  assert.equal(errorText('The set of enabled rulesets exceeds the rule count limit.'), `The set of enabled rulesets exceeds the rule count limit. ${MAKE_ROOM}`);
  assert.equal(errorText('The set of enabled rulesets exceeds the regular expression rule count limit.'), `The set of enabled rulesets exceeds the regular expression rule count limit. ${MAKE_ROOM}`);
  assert.equal(errorText('Rule with id 3 specified an invalid regular expression.'), `Rule with id 3 specified an invalid regular expression. ${GENERAL}`);
  assert.equal(errorText('Dynamic rule count exceeded.'), `Dynamic rule count exceeded. ${GENERAL}`);
  assert.equal(errorText('Chrome refused a rule'), `Chrome refused a rule. ${GENERAL}`);
});

test('counts group thousands, and one is singular', () => {
  assert.equal(count(1234, 'ad', 'ads'), '1,234 ads');
  assert.equal(count(1, 'ad', 'ads'), '1 ad');
  assert.equal(count(0, 'tracker', 'trackers'), '0 trackers');
});

function fakeChrome(setFails: boolean) {
  const store = new Map<string, unknown>([['settings', structuredClone(DEFAULT_SETTINGS)]]);
  const logged: unknown[][] = [];
  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}),
        set: async (items: Record<string, unknown>) => {
          if (setFails) throw new Error('QUOTA_BYTES quota exceeded');
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
        },
      },
    },
  };
  console.error = (...args: unknown[]) => void logged.push(args);
  return { logged, settings: () => store.get('settings') as Settings };
}

test('a saved switch resolves true; a failed save resolves false and is logged, so the switch can flip back', async () => {
  const error = console.error;
  try {
    let t = fakeChrome(false);
    assert.equal(await setList('ads', false), true);
    assert.equal(t.settings().blocking.lists.ads, false);
    assert.deepEqual(t.logged, []);

    t = fakeChrome(true);
    assert.equal(await setList('ads', false), false);
    assert.equal(t.settings().blocking.lists.ads, true);
    assert.equal(t.logged.length, 1);
    assert.match(String(t.logged[0][0]), /could not save the settings/);
  } finally {
    console.error = error;
  }
});
