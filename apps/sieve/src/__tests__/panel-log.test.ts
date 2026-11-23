import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTHY_MS, MAX_QUICK_DROPS, MAX_ROWS, addRow, afterDrop, filterSources, listName, type Row } from '../panel-log.ts';

const row = (n: number): Row => ({ at: n, type: 'script', url: `https://ads.example/${n}.js`, list: 'Ads', filter: '||ads.example^' });

test('the table keeps the newest rows and says when it dropped older ones', () => {
  const rows: Row[] = [];
  for (let n = 1; n <= MAX_ROWS; n++) assert.equal(addRow(rows, row(n)), false);
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(addRow(rows, row(MAX_ROWS + 1)), true);
  assert.equal(addRow(rows, row(MAX_ROWS + 2)), true);
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(rows[0].at, 3);
  assert.equal(rows[MAX_ROWS - 1].at, MAX_ROWS + 2);
});

test('a list is shown by the name the menu and the settings page use, My filters for the dynamic rules, and the raw id for anything else', () => {
  assert.equal(listName('ads'), 'Ads');
  assert.equal(listName('trackers'), 'Trackers');
  assert.equal(listName('antiadblock'), 'Ad blocker warnings');
  assert.equal(listName('_dynamic'), 'My filters');
  assert.equal(listName('constructor'), 'constructor');
});

test('filter text is loaded once per list, an unknown rule has no text, and a list that was forgotten is loaded again', async () => {
  const loads: string[] = [];
  const source = filterSources(async (rulesetId): Promise<Record<string, string>> => {
    loads.push(rulesetId);
    return rulesetId === 'ads' ? { 7: '||ads.example^', 8: '||b.example^' } : { 1: '/mine$script' };
  });
  const [a, b, c] = await Promise.all([source.get('ads', 7), source.get('ads', 8), source.get('ads', 9)]);
  assert.deepEqual([a, b, c], ['||ads.example^', '||b.example^', '']);
  assert.equal(await source.get('_dynamic', 1), '/mine$script');
  assert.deepEqual(loads, ['ads', '_dynamic']);
  source.forget('_dynamic');
  assert.equal(await source.get('_dynamic', 1), '/mine$script');
  assert.deepEqual(loads, ['ads', '_dynamic', '_dynamic']);
});

test('a list that fails to load gives no text, is logged, and is tried again by the next row', async () => {
  const logged: unknown[][] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    let attempts = 0;
    const source = filterSources(async () => {
      if (attempts++ === 0) throw new Error('HTTP 500');
      return { 1: '||ads.example^' };
    });
    assert.equal(await source.get('ads', 1), '');
    assert.equal(logged.length, 1);
    assert.equal(await source.get('ads', 1), '||ads.example^');
    assert.equal(attempts, 2);
  } finally {
    console.error = error;
  }
});

test('a port that lived long or delivered a message is replaced at once, and an idle tab never makes the panel give up', () => {
  let quick = 0;
  for (let cycle = 0; cycle < 20; cycle++) {
    const next = afterDrop(quick, HEALTHY_MS, false);
    assert.deepEqual(next, { quickDrops: 0, retryMs: 0 });
    quick = next.quickDrops;
  }
  assert.deepEqual(afterDrop(3, 10, true), { quickDrops: 0, retryMs: 0 });
});

test('ports that drop right away are retried after longer waits, then the panel gives up; a good port in between starts the count over', () => {
  const waits: (number | null)[] = [];
  let quick = 0;
  for (let n = 1; n <= MAX_QUICK_DROPS; n++) {
    const next = afterDrop(quick, 20, false);
    waits.push(next.retryMs);
    quick = next.quickDrops;
  }
  assert.deepEqual(waits, [250, 500, 1000, 2000, null]);
  assert.deepEqual(afterDrop(MAX_QUICK_DROPS - 1, HEALTHY_MS - 1, false).retryMs, null);
  assert.deepEqual(afterDrop(MAX_QUICK_DROPS - 1, 20, true), { quickDrops: 0, retryMs: 0 });
});
