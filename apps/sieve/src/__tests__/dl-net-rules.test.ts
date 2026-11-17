import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOW_PRIORITY, ALLOW_RULE_ID, PROBE_RULE_FIRST, RECORD_RULE_FIRST, RECORD_RULE_LAST, REFERER_PRIORITY, addProbeRule, allowRule, recordRules, refererRule } from '../dl/net-rules.ts';
import { fakeIndexedDb } from './dl-idb-fakes.ts';

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

function fakeChrome(onCall?: (n: number) => Promise<void>) {
  const calls: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }[] = [];
  fakeIndexedDb();
  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: { id: ID },
    declarativeNetRequest: {
      updateSessionRules: async (o: (typeof calls)[number]) => {
        calls.push(o);
        await onCall?.(calls.length);
      },
    },
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

const urls = (c: { addRules?: chrome.declarativeNetRequest.Rule[] }) => c.addRules!.map((r) => r.condition.urlFilter);

test('a failed sync rejects its caller, runs the next one anyway, and keeps its extras pending until dropped', async () => {
  const calls = fakeChrome(async (n) => {
    if (n === 1) throw new Error('bad rule');
  });
  const m = (await import(`../dl/net-rules.ts?fresh=${4}`)) as typeof import('../dl/net-rules.ts');
  const a = [{ url: 'https://x/a', referrer: 'https://r/' }];
  await assert.rejects(m.syncRecordRules(a), /bad rule/);
  await m.syncRecordRules([{ url: 'https://x/b', referrer: 'https://r/' }]);
  assert.deepEqual(urls(calls.at(-1)!), ['|https://x/a|', '|https://x/b|']);
});

test('syncs run one at a time', async () => {
  let inFlight = 0;
  let most = 0;
  const calls = fakeChrome(async () => {
    most = Math.max(most, ++inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
  });
  const m = (await import(`../dl/net-rules.ts?fresh=${5}`)) as typeof import('../dl/net-rules.ts');
  await Promise.all([m.syncRecordRules([{ url: 'https://x/a', referrer: 'https://r/' }]), m.syncRecordRules([{ url: 'https://x/b', referrer: 'https://r/' }])]);
  assert.equal(most, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(urls(calls[1]), ['|https://x/a|', '|https://x/b|']);
});

test('a sync whose records cannot be read rejects and leaves the session rules as they are', async () => {
  const calls = fakeChrome();
  fakeIndexedDb(new Error('UnknownError: Internal error opening backing store'));
  const m = (await import(`../dl/net-rules.ts?fresh=${6}`)) as typeof import('../dl/net-rules.ts');
  await assert.rejects(m.syncRecordRules([]), /backing store/);
  assert.equal(calls.length, 0, 'no update that would remove every record rule');
});

test('readAllRecords rejects when the database cannot be opened, and gives the records when it can', async () => {
  const { readAllRecords } = (await import(`../dl/idb-store.ts?fresh=${1}`)) as typeof import('../dl/idb-store.ts');
  fakeIndexedDb(new Error('UnknownError'));
  await assert.rejects(readAllRecords(), /UnknownError/);
  fakeIndexedDb([{ id: 'd1' }]);
  assert.deepEqual(await readAllRecords(), [{ id: 'd1' }]);
});
