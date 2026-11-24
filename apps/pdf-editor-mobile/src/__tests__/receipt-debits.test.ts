import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DebitRow } from 'nexus-links';

import type { DebitsRead } from '../links/readers.ts';
import { candidateLine, matchLine, readAllDebits, readLine } from '../nexus/receipt-debits.ts';

const row = (id: number): DebitRow => ({ id, amount_minor: 1250, at: new Date(2026, 10, 20, 9).getTime(), merchant: 'Corner Cafe', account: 'Main ****1234' });
const pages = (...list: DebitRow[][]) => {
  const asked: number[] = [];
  const read = async (since: number): Promise<DebitsRead> => {
    asked.push(since);
    return { status: 'ready', rows: list[asked.length - 1] ?? [] };
  };
  return { read, asked };
};

test('pages are read forward from the last id until one is empty', async () => {
  const p = pages([row(1), row(5)], [row(9)], []);
  const r = await readAllDebits(p.read);
  assert.equal(r.status, 'ready');
  assert.deepEqual(r.rows.map((d) => d.id), [1, 5, 9]);
  assert.deepEqual(p.asked, [0, 5, 9]);
});

test('an empty first page is a ready read with no rows', async () => {
  assert.deepEqual(await readAllDebits(pages([]).read), { status: 'ready', rows: [] });
});

test('off, missing and failed on the first page are passed on', async () => {
  for (const status of ['off', 'missing', 'failed'] as const) {
    assert.deepEqual(await readAllDebits(async () => ({ status, rows: [] })), { status, rows: [] });
  }
});

test('a page that fails later makes the whole read failed, never a shorter list', async () => {
  let n = 0;
  const r = await readAllDebits(async () => (n++ === 0 ? { status: 'ready', rows: [row(3)] } : { status: 'off', rows: [] }));
  assert.deepEqual(r, { status: 'failed', rows: [] });
});

test('a page that does not move forward, or too many pages, fails', async () => {
  assert.equal((await readAllDebits(async () => ({ status: 'ready', rows: [row(4)] }))).status, 'failed');
  let id = 0;
  const endless = async (): Promise<DebitsRead> => ({ status: 'ready', rows: [row(++id)] });
  assert.equal((await readAllDebits(endless, 10)).status, 'failed');
  assert.equal(id, 10);
});

test('plain lines for each outcome', () => {
  assert.equal(readLine('ready'), null);
  assert.equal(readLine('off'), "Off in Inflow. Turn on 'Let Nexus match my receipts' in Inflow.");
  assert.equal(readLine('missing'), "Inflow isn't installed.");
  assert.equal(readLine('failed'), "Couldn't read Inflow right now.");
  assert.equal(matchLine({ kind: 'match', debit: row(1) }), 'This looks like your Corner Cafe payment of 12.50 on 20 Nov. Is it the same?');
  assert.equal(matchLine({ kind: 'match', debit: { ...row(1), merchant: ' ' } }), 'This looks like your payment of 12.50 on 20 Nov. Is it the same?');
  assert.equal(matchLine({ kind: 'weak', candidates: [row(1)] }), "Amount and date match, the name doesn't. Is one of these yours?");
  assert.equal(matchLine({ kind: 'none' }), "No matching payment found yet. If you haven't, turn on 'Let Nexus match my receipts' in Inflow.");
  assert.equal(candidateLine(row(1)), '20 Nov, 12.50');
  assert.ok(!matchLine({ kind: 'match', debit: row(1) }).includes('1234'), 'the account label is never shown');
});
