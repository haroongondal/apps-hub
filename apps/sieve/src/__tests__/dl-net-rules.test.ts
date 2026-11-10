import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW_PRIORITY, ALLOW_RULE_ID, PROBE_RULE_FIRST, RECORD_RULE_FIRST, RECORD_RULE_LAST, REFERER_PRIORITY, addProbeRule, allowRule, recordRules, refererRule } from '../dl/net-rules.ts';

const ID = 'abcdefghijklmnop';
const rec = (id: string, url: string, referrer = 'https://r.example/', state = 'queued', finalUrl = url) => ({ id, url, finalUrl, referrer, state });

test('allowRule has the exact shape', () => {
  assert.deepEqual(allowRule(ID), { id: 1, priority: 2_000_000_000, action: { type: 'allow' }, condition: { initiatorDomains: [ID], resourceTypes: ['xmlhttprequest', 'other'] } });
  assert.equal(ALLOW_RULE_ID, 1);
});

test('refererRule has the exact shape and outranks the allow rule', () => {
  assert.deepEqual(refererRule(1005, 'https://a.example/f.bin', 'https://r.example/p', ID), {
    id: 1005,
    priority: 2_000_000_001,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://r.example/p' }] },
    condition: { urlFilter: '|https://a.example/f.bin|', initiatorDomains: [ID], resourceTypes: ['xmlhttprequest', 'other'] },
  });
  assert.ok(REFERER_PRIORITY > ALLOW_PRIORITY);
});

test('recordRules numbers rules from 1000 in record-id order', () => {
  const rules = recordRules([rec('b', 'https://x/b'), rec('a', 'https://x/a')], ID);
  assert.deepEqual(rules.map((r) => [r.id, r.condition.urlFilter]), [[1000, '|https://x/a|'], [1001, '|https://x/b|']]);
});

test('recordRules skips done records and empty referrers', () => {
  const rules = recordRules([rec('a', 'https://x/a', 'https://r/', 'done'), rec('b', 'https://x/b', ''), rec('c', 'https://x/c', 'https://r/', 'failed')], ID);
  assert.deepEqual(rules.map((r) => r.condition.urlFilter), ['|https://x/c|']);
});

test('recordRules adds one rule for url and one for a different finalUrl, none duplicated', () => {
  const rules = recordRules([rec('a', 'https://x/a', 'https://r/', 'queued', 'https://cdn/a'), rec('b', 'https://x/b')], ID);
  assert.deepEqual(rules.map((r) => r.condition.urlFilter), ['|https://x/a|', '|https://cdn/a|', '|https://x/b|']);
});

test('recordRules stops at 1000 rules', () => {
  const many = Array.from({ length: 1200 }, (_, i) => rec(`d${String(i).padStart(4, '0')}`, `https://x/${i}`));
  const rules = recordRules(many, ID);
  assert.equal(rules.length, RECORD_RULE_LAST - RECORD_RULE_FIRST + 1);
  assert.equal(rules[0].id, RECORD_RULE_FIRST);
  assert.equal(rules.at(-1)!.id, RECORD_RULE_LAST);
  // a record with two URLs that does not fit whole still stops at the limit
  const two = Array.from({ length: 600 }, (_, i) => rec(`e${String(i).padStart(4, '0')}`, `https://x/${i}`, 'https://r/', 'queued', `https://y/${i}`));
  assert.equal(recordRules(two, ID).length, 1000);
});

function fakeChrome() {
  const calls: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }[] = [];
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: { id: ID },
    declarativeNetRequest: { updateSessionRules: async (o: (typeof calls)[number]) => void calls.push(o) },
  };
  return calls;
}

test('addProbeRule removes the id in the call that adds it', async () => {
  const calls = fakeChrome();
  const { addProbeRule: add } = (await import(`../dl/net-rules.ts?fresh=${1}`)) as typeof import('../dl/net-rules.ts');
  await add('https://x/a', 'https://r/');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].removeRuleIds, [PROBE_RULE_FIRST]);
  assert.equal(calls[0].addRules![0].id, PROBE_RULE_FIRST);
  assert.equal(calls[0].addRules![0].priority, REFERER_PRIORITY);
});

test('addProbeRule wraps its counter at 1000', async () => {
  const calls = fakeChrome();
  const { addProbeRule: add } = (await import(`../dl/net-rules.ts?fresh=${2}`)) as typeof import('../dl/net-rules.ts');
  for (let i = 0; i < 1001; i++) await add('https://x/a', 'https://r/');
  assert.equal(calls[999].addRules![0].id, PROBE_RULE_FIRST + 999);
  assert.equal(calls[1000].addRules![0].id, PROBE_RULE_FIRST);
});

test('addProbeRule returns a remover that removes the rule', async () => {
  const calls = fakeChrome();
  const remove = await addProbeRule('https://x/a', 'https://r/');
  await remove();
  assert.deepEqual(calls.at(-1), { removeRuleIds: [calls[0].addRules![0].id] });
});

test('addProbeRule with an empty referrer returns a no-op', async () => {
  const calls = fakeChrome();
  const remove = await addProbeRule('https://x/a', '');
  await remove();
  assert.equal(calls.length, 0);
});

test('recordRules and addProbeRule skip non-ASCII URLs and referrers without failing', async () => {
  const rules = recordRules([rec('a', 'https://x/é.bin'), rec('b', 'https://x/b', 'https://r/é'), rec('c', 'https://x/c')], ID);
  assert.deepEqual(rules.map((r) => r.condition.urlFilter), ['|https://x/c|']);
  const calls = fakeChrome();
  await (await addProbeRule('https://x/é.bin', 'https://r/'))();
  assert.equal(calls.length, 0);
});

test('two overlapping syncRecordRules calls keep both rules, and a dropped extra leaves the next sync', async () => {
  const calls = fakeChrome();
  const m = (await import(`../dl/net-rules.ts?fresh=${3}`)) as typeof import('../dl/net-rules.ts');
  const a = [{ url: 'https://x/a', referrer: 'https://r/' }];
  const b = [{ url: 'https://x/b', referrer: 'https://r/' }];
  const first = m.syncRecordRules(a);
  const second = m.syncRecordRules(b);
  await Promise.all([first, second]);
  assert.deepEqual(calls.at(-1)!.addRules!.map((r) => r.condition.urlFilter), ['|https://x/a|', '|https://x/b|']);
  m.dropPendingRules(a);
  await m.syncRecordRules([]);
  assert.deepEqual(calls.at(-1)!.addRules!.map((r) => r.condition.urlFilter), ['|https://x/b|']);
});
