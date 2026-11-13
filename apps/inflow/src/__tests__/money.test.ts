import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAmount, monthLabel, monthRange, shiftMonth } from '../money.ts';

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
