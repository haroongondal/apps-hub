import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DebitRow } from 'nexus-links';

import { dayGap, matchReceipt, merchantScore } from '../nexus/receipt-match.ts';
import type { Receipt } from '../nexus/receipt-parse.ts';

const receipt: Receipt = { amountMinor: 1250, date: '2026-11-20', merchant: 'Corner Cafe' };
const at = (day: number, hour = 9) => new Date(2026, 10, day, hour).getTime();
const debit = (id: number, over: Partial<DebitRow> = {}): DebitRow => ({ id, amount_minor: 1250, at: at(20), merchant: 'Corner Cafe', account: 'Main ****1234', ...over });

test('the same amount, day and name is a match', () => {
  const d = debit(1);
  assert.deepEqual(matchReceipt(receipt, [d]), { kind: 'match', debit: d });
});

test('an amount off by one minor unit does not qualify, whatever the name', () => {
  assert.deepEqual(matchReceipt(receipt, [debit(1, { amount_minor: 1249 }), debit(2, { amount_minor: 1251 })]), { kind: 'none' });
});

test('three days either side qualifies, four does not', () => {
  assert.equal(matchReceipt(receipt, [debit(1, { at: at(23, 23) })]).kind, 'match');
  assert.equal(matchReceipt(receipt, [debit(1, { at: at(17, 0) })]).kind, 'match');
  assert.deepEqual(matchReceipt(receipt, [debit(1, { at: at(24, 9) })]), { kind: 'none' });
  assert.deepEqual(matchReceipt(receipt, [debit(1, { at: at(16, 23) })]), { kind: 'none' });
});

test('the gap counts local calendar days across a clock change', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    // Clocks went forward on 29 March 2026: 28 to 31 March is three calendar days, only 71 hours.
    assert.equal(dayGap(new Date(2026, 2, 28, 0, 30).getTime(), '2026-03-31'), 3);
    assert.equal(dayGap(new Date(2026, 2, 31, 23, 30).getTime(), '2026-03-28'), 3);
    assert.equal(dayGap(new Date(2026, 2, 27, 23, 30).getTime(), '2026-03-31'), 4);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('two equally good debits are a tie, listed up to three', () => {
  const list = [debit(1), debit(2), debit(3), debit(4)];
  const m = matchReceipt(receipt, list);
  assert.equal(m.kind, 'tie');
  assert.ok(m.kind === 'tie' && m.candidates.length === 3);
});

test('a closer day wins over an equally named debit further away', () => {
  const near = debit(2, { at: at(20) });
  assert.deepEqual(matchReceipt(receipt, [debit(1, { at: at(22) }), near]), { kind: 'match', debit: near });
});

test('a better name wins over a closer day', () => {
  const better = debit(2, { at: at(22), merchant: 'Corner Cafe' });
  const worse = debit(1, { at: at(20), merchant: 'Corner Kafe' });
  assert.ok(merchantScore('Corner Kafe', 'Corner Cafe') >= 0.5 && merchantScore('Corner Kafe', 'Corner Cafe') < 1);
  assert.deepEqual(matchReceipt(receipt, [worse, better]), { kind: 'match', debit: better });
});

test('right amount and day with another name is weak, never a match', () => {
  const m = matchReceipt(receipt, [debit(1, { merchant: 'Zed Hardware' })]);
  assert.equal(m.kind, 'weak');
  assert.ok(m.kind === 'weak' && m.candidates.length === 1 && m.candidates[0].id === 1);
  const many = matchReceipt(receipt, [1, 2, 3, 4].map((i) => debit(i, { merchant: 'Zed Hardware' })));
  assert.ok(many.kind === 'weak' && many.candidates.length === 3);
});

test('a named match beats weak ones', () => {
  const good = debit(2);
  assert.deepEqual(matchReceipt(receipt, [debit(1, { merchant: 'Zed Hardware' }), good]), { kind: 'match', debit: good });
});

test('the amount alone decides across currencies: nothing else is compared', () => {
  const m = matchReceipt(receipt, [debit(1, { account: 'Dubai card USD ****9999' })]);
  assert.equal(m.kind, 'match');
});

test('an empty list, or only other amounts and dates, finds nothing', () => {
  assert.deepEqual(matchReceipt(receipt, []), { kind: 'none' });
  assert.deepEqual(matchReceipt(receipt, [debit(1, { amount_minor: 5 }), debit(2, { at: at(1) })]), { kind: 'none' });
});

test('accents, case, punctuation and legal suffixes are ignored', () => {
  assert.equal(merchantScore('CAFÉ  Münch, Ltd.', 'cafe munch'), 1);
  assert.equal(merchantScore('Acme Trading Pvt Ltd', 'ACME TRADING'), 1);
  assert.equal(merchantScore('LLC', 'Inc.'), 0, 'only suffixes left');
  assert.equal(merchantScore('Starbucks', 'POS 4412 STARBUCKS DXB'), 1);
  assert.ok(merchantScore('Starbucks Coffee', 'Starbucks') >= 0.5);
  assert.ok(merchantScore('Zed Hardware', 'Corner Cafe') < 0.5);
  assert.equal(merchantScore('', 'Corner Cafe'), 0);
});

test('a short Latin name is not "held" by a longer one by accident', () => {
  assert.ok(merchantScore('Al', 'Alpha Mart') < 0.5);
});

test('Arabic and Urdu names match only when one holds the other', () => {
  const r = { ...receipt, merchant: 'کیفے کارنر' };
  assert.equal(matchReceipt(r, [debit(1, { merchant: 'کیفے کارنر لاہور' })]).kind, 'match');
  assert.equal(merchantScore('كافيه', 'كافيه الرياض'), 1);
  assert.equal(merchantScore('کیفے کارنر', 'کیفے کارنے'), 0, 'close spelling is not a match in these scripts');
  assert.equal(matchReceipt(r, [debit(1, { merchant: 'کیفے کارنے' })]).kind, 'weak');
});

test('inputs are never changed', () => {
  const list = [debit(2, { merchant: 'Zed' }), debit(1)];
  const copy = structuredClone(list);
  const r = structuredClone(receipt);
  matchReceipt(r, list);
  assert.deepEqual(list, copy);
  assert.deepEqual(r, receipt);
});
