import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ADD_TODO, validateExtras } from '../../../../packages/app-link-contract/src/index.ts';
import type { Receipt } from '../nexus/receipt-parse.ts';
import { warrantyReminder } from '../nexus/receipt-reminder.ts';

const NOW = new Date(2026, 10, 24, 10).getTime();
const receipt = (over: Partial<Receipt> = {}): Receipt => ({ amountMinor: 49900, date: '2026-11-20', merchant: 'Corner Electronics', warrantyEnd: '2028-11-20', ...over });

test('the reminder is two weeks before the warranty ends, at local midday', () => {
  const r = warrantyReminder(receipt(), NOW);
  assert.ok(r);
  assert.equal(r.dueAt, new Date(2028, 10, 6, 12).getTime());
  assert.equal(r.title, 'Warranty ends: Corner Electronics');
  assert.equal(r.note, 'Warranty for Corner Electronics ends on 20 Nov 2028. Receipt scanned in Nexus.');
});

test('the extras are what the contract accepts, with a camelCase dueAt and source Nexus', () => {
  const r = warrantyReminder(receipt(), NOW);
  assert.ok(r);
  assert.deepEqual(r.extras, { title: r.title, source: 'Nexus', note: r.note, dueAt: r.dueAt });
  const v = validateExtras(ADD_TODO, r.extras as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? '' : v.reason);
  assert.equal('due_at' in r.extras, false);
});

test('no warranty date, or a reminder moment already past, gives nothing', () => {
  assert.equal(warrantyReminder(receipt({ warrantyEnd: undefined }), NOW), null);
  assert.equal(warrantyReminder(receipt({ warrantyEnd: '2026-12-01' }), NOW), null, 'ends in 7 days: the reminder would be in the past');
});

test('the boundary is midday of the reminder day against now', () => {
  const end = receipt({ warrantyEnd: '2026-12-08' });
  assert.ok(warrantyReminder(end, new Date(2026, 10, 24, 11, 59).getTime()));
  assert.equal(warrantyReminder(end, new Date(2026, 10, 24, 12, 0).getTime()), null);
});

test('fourteen days are calendar days across a clock change', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    // Clocks went forward on 29 March 2026; 5 April minus 14 days is 22 March, still 12:00 local.
    const r = warrantyReminder(receipt({ warrantyEnd: '2026-04-05', date: '2026-03-01' }), new Date(2026, 2, 1, 10).getTime());
    assert.ok(r);
    assert.equal(r.dueAt, new Date(2026, 2, 22, 12).getTime());
    assert.equal(new Date(r.dueAt).getHours(), 12);
    const back = warrantyReminder(receipt({ warrantyEnd: '2026-11-02', date: '2026-10-01' }), new Date(2026, 9, 1, 10).getTime());
    assert.ok(back);
    assert.equal(back.dueAt, new Date(2026, 9, 19, 12).getTime(), 'clocks went back on 25 October');
    assert.equal(new Date(back.dueAt).getHours(), 12);
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});

test('a long merchant is cut so the title stays within 200 and the note within 500', () => {
  const r = warrantyReminder(receipt({ merchant: 'word '.repeat(60).trim() }), NOW);
  assert.ok(r && r.title.length <= 200 && r.note.length <= 500 && r.title.startsWith('Warranty ends: word'));
  const v = validateExtras(ADD_TODO, r.extras as Record<string, unknown>);
  assert.equal(v.ok, true, v.ok ? '' : v.reason);
});

test('the receipt is never changed', () => {
  const r = receipt();
  const copy = structuredClone(r);
  warrantyReminder(r, NOW);
  assert.deepEqual(r, copy);
});
