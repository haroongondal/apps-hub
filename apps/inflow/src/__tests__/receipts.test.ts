import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountsIn, matchReceipt, receiptWindow } from '../receipts.ts';

test('amounts read with and without separators, in minor units', () => {
  assert.deepEqual(amountsIn('Total PKR 1,250.00'), [125000]);
  assert.deepEqual(amountsIn('Rs 1250'), [125000]);
  assert.deepEqual(amountsIn('Paid 1 250.5 today'), [125050]);
  assert.deepEqual(amountsIn('Ref 1234567'), [123456700]);
});

test('a photo with the transaction amount matches; a near amount does not', () => {
  const txn = { amount: 125000, counterparty: null };
  assert.equal(matchReceipt('Grand total PKR 1,250.00 Thank you', txn).amountMatch, true);
  assert.equal(matchReceipt('Grand total PKR 1,205.00', txn).amountMatch, false);
  assert.equal(matchReceipt('Subtotal 1,250 tax 0', txn).amountMatch, true);
});

test('the counterparty matches by a four-letter word, case-insensitive', () => {
  const txn = { amount: 50000, counterparty: 'Careem Pakistan' };
  assert.equal(matchReceipt('CAREEM ride receipt', txn).nameMatch, true);
  assert.equal(matchReceipt('Pay the bill', { amount: 1, counterparty: 'Ali' }).nameMatch, false);
});

test('score counts the amount twice as much as the name', () => {
  const txn = { amount: 50000, counterparty: 'Careem' };
  assert.equal(matchReceipt('Careem 500.00', txn).score, 3);
  assert.equal(matchReceipt('Careem', txn).score, 1);
  assert.equal(matchReceipt('nothing here', txn).score, 0);
});

test('the window runs three days back and one day forward', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.deepEqual(receiptWindow(10 * day), { from: 7 * day, to: 11 * day });
});
