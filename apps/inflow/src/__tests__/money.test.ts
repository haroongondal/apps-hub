import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Txn } from 'inflow-core';
import { formatAmount, monthLabel, monthRange, partySubtitle, partyTitle, shiftMonth, signedAmount, withinMonth } from '../money.ts';

test('formatAmount groups thousands and keeps two decimals from integers', () => {
  assert.equal(formatAmount(150000, 'PKR'), 'PKR 1,500.00');
  assert.equal(formatAmount(59324901, 'PKR'), 'PKR 593,249.01');
  assert.equal(formatAmount(5000000, 'PKR'), 'PKR 50,000.00');
  assert.equal(formatAmount(5, 'PKR'), 'PKR 0.05');
  assert.equal(formatAmount(0, 'PKR'), 'PKR 0.00');
  assert.equal(formatAmount(99, 'USD'), 'USD 0.99');
  assert.equal(formatAmount(100000000000, 'PKR'), 'PKR 1,000,000,000.00');
});

test('formatAmount is exact where float division would round', () => {
  assert.equal(formatAmount(1005, 'PKR'), 'PKR 10.05');
  assert.equal(formatAmount(Number.MAX_SAFE_INTEGER, 'PKR'), 'PKR 90,071,992,547,409.91');
});

test('formatAmount puts the minus sign first', () => {
  assert.equal(formatAmount(-150000, 'PKR'), '-PKR 1,500.00');
});

test('monthRange covers one local month and rolls over December', () => {
  const nov = monthRange(2026, 10);
  assert.equal(nov.from, new Date(2026, 10, 1).getTime());
  assert.equal(nov.to, new Date(2026, 11, 1).getTime());
  const dec = monthRange(2026, 11);
  assert.equal(dec.to, new Date(2027, 0, 1).getTime());
});

test('monthLabel and shiftMonth', () => {
  assert.equal(monthLabel(2026, 10), 'November 2026');
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth(2026, 5, 7), { year: 2027, month: 0 });
});

const txn = (id: number, at: number): Txn => ({ id, direction: 'out', amount: 100, currency: 'PKR', account: 'UBL 1733', counterparty: null, txId: null, at, own: false, paired: false, itemIds: [], category: null, label: null, byAi: false });

test('withinMonth drops rows after the month and stops at the first row before it', () => {
  const { from, to } = monthRange(2026, 10);
  const page = [txn(4, to), txn(3, to - 1), txn(2, from), txn(1, from - 1)];
  const r = withinMonth(page, from, to);
  assert.deepEqual(r.rows.map((t) => t.id), [3, 2]);
  assert.equal(r.done, true);
  assert.equal(withinMonth([txn(3, to - 1), txn(2, from)], from, to).done, false);
});

test('signedAmount shows the direction', () => {
  assert.equal(signedAmount({ direction: 'in', amount: 150000, currency: 'PKR' }), '+PKR 1,500.00');
  assert.equal(signedAmount({ direction: 'out', amount: 150000, currency: 'PKR' }), '-PKR 1,500.00');
});

test('partyTitle names own transfers and unknown parties', () => {
  assert.equal(partyTitle({ name: null, own: true }), 'Between your accounts');
  assert.equal(partyTitle({ name: null, own: false }), 'Unknown');
  assert.equal(partyTitle({ name: 'KFC', own: false }), 'KFC');
});

test('partySubtitle leaves out a side with no money', () => {
  assert.equal(partySubtitle({ currency: 'PKR', moneyIn: 0, moneyOut: 180000, count: 3 }), 'Out PKR 1,800.00 · 3 transactions');
  assert.equal(partySubtitle({ currency: 'PKR', moneyIn: 2000000, moneyOut: 0, count: 1 }), 'In PKR 20,000.00 · 1 transaction');
  assert.equal(partySubtitle({ currency: 'PKR', moneyIn: 2500000, moneyOut: 2500000, count: 2 }), 'In PKR 25,000.00 · out PKR 25,000.00 · 2 transactions');
});
