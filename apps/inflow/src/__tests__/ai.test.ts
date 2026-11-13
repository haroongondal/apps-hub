import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capLabel, dueLabel, kindLabel, parseCap, sendResultLabel, askBasis, importanceLabel } from '../ai.ts';

// TZ is Asia/Karachi (UTC+5, no daylight saving) in the test script.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;
const now = at(2026, 11, 14, 8, 0); // a Saturday

test('kindLabel uses sentence case', () => {
  assert.equal(kindLabel('account_alert'), 'Account alert');
  assert.equal(kindLabel('bill'), 'Bill');
  assert.equal(kindLabel('promotion'), 'Promotion');
});

test('capLabel shows the limit or says there is none', () => {
  assert.equal(capLabel(0.5, 0.12), '$0.12 of $0.50 today');
  assert.equal(capLabel(null, 0.12), '$0.12 today, no limit');
  assert.equal(capLabel(0.5, 0), '$0.00 of $0.50 today');
});

test('dueLabel names today, tomorrow, a weekday, then a date', () => {
  assert.equal(dueLabel(at(2026, 11, 14, 11, 0), now), 'Today 11:00');
  assert.equal(dueLabel(at(2026, 11, 14, 0, 5), at(2026, 11, 14, 23, 0)), 'Today 00:05');
  assert.equal(dueLabel(at(2026, 11, 15, 9, 30), now), 'Tomorrow 09:30');
  assert.equal(dueLabel(at(2026, 11, 20, 9, 30), now), 'Friday 09:30');
  assert.equal(dueLabel(at(2026, 11, 21, 9, 30), now), 'Saturday 09:30');
  assert.equal(dueLabel(at(2026, 11, 22, 9, 30), now), '22 Nov 09:30');
  assert.equal(dueLabel(at(2027, 1, 3, 18, 0), now), '3 Jan 2027 18:00');
});

test('dueLabel handles no date and a day already gone', () => {
  assert.equal(dueLabel(null, now), 'No date');
  assert.equal(dueLabel(at(2026, 11, 12, 9, 0), now), '12 Nov 09:00');
});

test('parseCap reads dollars, blank as no limit, and rejects the rest', () => {
  assert.equal(parseCap(''), null);
  assert.equal(parseCap('  '), null);
  assert.equal(parseCap('0.50'), 0.5);
  assert.equal(parseCap('$2'), 2);
  assert.equal(parseCap('100'), 100);
  assert.equal(parseCap('0.01'), 0.01);
  assert.equal(parseCap('0'), 'invalid');
  assert.equal(parseCap('100.01'), 'invalid');
  assert.equal(parseCap('abc'), 'invalid');
  assert.equal(parseCap('-1'), 'invalid');
  assert.equal(parseCap('1e3'), 'invalid');
});

test('sendResultLabel says what happened in plain words', () => {
  assert.equal(sendResultLabel(0, 0), 'Nothing was waiting to send.');
  assert.equal(sendResultLabel(1, 1), 'Sent 1 item. 1 came back with a summary.');
  assert.equal(sendResultLabel(12, 10), 'Sent 12 items. 10 came back with a summary.');
});

test('importanceLabel capitalises', () => {
  assert.equal(importanceLabel('high'), 'High');
  assert.equal(importanceLabel('low'), 'Low');
});

test('askBasis counts and names the range, an exclusive midnight end included', () => {
  assert.equal(askBasis(12, 3, at(2026, 11, 1, 0, 0), at(2026, 11, 14, 8, 0), now), 'Based on 12 messages and 3 transactions from 1 Nov to 14 Nov');
  assert.equal(askBasis(1, 1, at(2026, 11, 1, 0, 0), at(2026, 12, 1, 0, 0), now), 'Based on 1 message and 1 transaction from 1 Nov to 30 Nov');
  assert.equal(askBasis(0, 0, at(2026, 11, 14, 0, 0), at(2026, 11, 15, 0, 0), now), 'Based on 0 messages and 0 transactions from 14 Nov');
  assert.equal(askBasis(2, 0, at(2025, 12, 20, 0, 0), at(2026, 1, 5, 12, 0), now), 'Based on 2 messages and 0 transactions from 20 Dec 2025 to 5 Jan');
});
