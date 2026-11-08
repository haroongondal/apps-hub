import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW_FIRST_ID, DEFAULT_SETTINGS, blockingPlan, validateSettings, type BuildMeta, type DnrRule, type Settings } from '../index.ts';

const WEB = ['http://*/*', 'https://*/*'];
const feature = (ruleset: string | null, hasGenericCss: boolean, genericExcept: string[] = []) => ({ ruleset, ruleCount: ruleset ? 10 : 0, hasGenericCss, genericExcept, allowIds: [], modifyIds: [] });
const meta: BuildMeta = {
  builtAt: '2026-11-06T00:00:00.000Z',
  maxPriority: 1000301,
  features: {
    ads: feature('ads', true, ['jetzt.de', '127.0.0.1']),
    trackers: feature('trackers', true),
    distraction: feature('distraction', true, ['archiveteam.org']),
    cookies: feature('cookies', false),
    antiadblock: feature('antiadblock', true),
    ai: feature(null, false),
  },
  scriptlets: ['set-constant'],
};

const withBlocking = (blocking: object): Settings => validateSettings({ ...DEFAULT_SETTINGS, blocking: { ...DEFAULT_SETTINGS.blocking, ...blocking } });
const ids = (plan: { registrations: { id: string }[] }) => plan.registrations.map((r) => r.id);

test('defaults enable every ruleset with rules, register the generic CSS and the notification blocker, and add no rules', () => {
  const plan = blockingPlan(DEFAULT_SETTINGS, meta, []);
  assert.deepEqual(plan.enableRulesets, ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock']);
  assert.deepEqual(plan.disableRulesets, []);
  assert.deepEqual(ids(plan), ['generic-ads', 'generic-trackers', 'generic-distraction', 'generic-antiadblock', 'deny-notifications']);
  assert.deepEqual(plan.registrations[0], {
    id: 'generic-ads',
    css: ['cosmetic/ads.generic.css'],
    matches: WEB,
    excludeMatches: ['*://*.jetzt.de/*', '*://127.0.0.1/*'],
    allFrames: true,
    runAt: 'document_start',
  });
  assert.deepEqual(plan.registrations.at(-1), {
    id: 'deny-notifications',
    js: ['notify-deny.js'],
    world: 'MAIN',
    matches: WEB,
    excludeMatches: [],
    allFrames: true,
    runAt: 'document_start',
  });
  assert.deepEqual(plan.dynamicRules, []);
});

test('a list switched off disables its ruleset and drops its generic CSS; ai turned on has nothing to enable', () => {
  const plan = blockingPlan(withBlocking({ lists: { ...DEFAULT_SETTINGS.blocking.lists, trackers: false, ai: true } }), meta, []);
  assert.deepEqual(plan.enableRulesets, ['ads', 'distraction', 'cookies', 'antiadblock']);
  assert.deepEqual(plan.disableRulesets, ['trackers']);
  assert.ok(!ids(plan).includes('generic-trackers'));
});

test('the notification switch off drops its registration', () => {
  assert.ok(!ids(blockingPlan(withBlocking({ denyNotifications: false }), meta, [])).includes('deny-notifications'));
});

test('paused or switched off: every ruleset off, nothing registered, no dynamic rules', () => {
  const myRules: DnrRule[] = [{ id: 1, action: { type: 'block' }, condition: { urlFilter: '||x.com^' } }];
  const allowlist = [{ kind: 'site', host: 'example.com' }];
  for (const settings of [withBlocking({ paused: true, allowlist }), { ...withBlocking({ allowlist }), enabled: false }]) {
    const plan = blockingPlan(settings, meta, myRules);
    assert.deepEqual(plan.enableRulesets, []);
    assert.deepEqual(plan.disableRulesets, ['ads', 'trackers', 'distraction', 'cookies', 'antiadblock']);
    assert.deepEqual(plan.registrations, []);
    assert.deepEqual(plan.dynamicRules, []);
  }
});

test('an allowlisted site leaves every registration and gets an allow rule above every list rule', () => {
  const plan = blockingPlan(withBlocking({ allowlist: [{ kind: 'site', host: 'example.com' }, { kind: 'page', url: 'https://a.com/p' }] }), meta, []);
  const ads = plan.registrations.find((r) => r.id === 'generic-ads');
  assert.deepEqual(ads?.excludeMatches, ['*://*.example.com/*', '*://*.jetzt.de/*', '*://127.0.0.1/*', '*://a.com/p*']);
  for (const r of plan.registrations) {
    assert.ok(r.excludeMatches.includes('*://*.example.com/*') && r.excludeMatches.includes('*://a.com/p*'), r.id);
  }
  assert.deepEqual(plan.dynamicRules.map((r) => [r.id, r.priority]), [
    [ALLOW_FIRST_ID, 1000302],
    [ALLOW_FIRST_ID + 1, 1000302],
  ]);
  assert.deepEqual(plan.dynamicRules[0].condition, { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] });
});

test('a host in both the allowlist and genericExcept appears once', () => {
  const plan = blockingPlan(withBlocking({ allowlist: [{ kind: 'site', host: 'jetzt.de' }] }), meta, []);
  assert.deepEqual(plan.registrations[0].excludeMatches, ['*://*.jetzt.de/*', '*://127.0.0.1/*']);
});

test('My filters pass through unchanged before the allow rules, which outrank their $important rules', () => {
  const myRules: DnrRule[] = [
    { id: 1, priority: 2000000, action: { type: 'block' }, condition: { urlFilter: '||x.com^' } },
    { id: 2, action: { type: 'block' }, condition: { urlFilter: '||y.com^' } },
  ];
  const plan = blockingPlan(withBlocking({ allowlist: [{ kind: 'site', host: 'example.com' }] }), meta, myRules);
  assert.equal(plan.dynamicRules[0], myRules[0]);
  assert.equal(plan.dynamicRules[1], myRules[1]);
  assert.equal(plan.dynamicRules.length, 3);
  assert.equal(plan.dynamicRules[2].priority, 2000001);
});

test('My filters apply with no allowlist, and the plan never mutates its inputs', () => {
  const myRules: DnrRule[] = [{ id: 1, action: { type: 'block' }, condition: { urlFilter: '||x.com^' } }];
  const before = JSON.stringify([DEFAULT_SETTINGS, meta, myRules]);
  assert.deepEqual(blockingPlan(DEFAULT_SETTINGS, meta, myRules).dynamicRules, myRules);
  assert.equal(JSON.stringify([DEFAULT_SETTINGS, meta, myRules]), before);
});
