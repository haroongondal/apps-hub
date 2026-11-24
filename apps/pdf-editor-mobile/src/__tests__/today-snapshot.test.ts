import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTodaySnapshot, cleanTitle, dueFor, dueText, startOfDay, TODAY_MAX_BYTES, TODAY_MAX_ITEMS, todayWindow } from '../nexus/today.ts';

const NOW = new Date(2026, 10, 24, 15, 30).getTime(); // 24 Nov 2026, local
const at = (day: number, h = 9) => new Date(2026, 10, day, h).getTime();
const parse = (text: string) => JSON.parse(text) as { v: number; on: boolean; items: { title: string; dueAt: number }[] };

test('the switch off serves nothing, whatever is due', () => {
  assert.equal(buildTodaySnapshot([{ title: 'Call the bank', dueAt: at(24) }], false, NOW), '{"v":1,"on":false,"items":[]}');
});

test('the switch on lists titles and due times in the format the provider reads', () => {
  const out = parse(buildTodaySnapshot([{ title: 'Pay rent', dueAt: at(25) }, { title: 'Call the bank', dueAt: at(24) }], true, NOW));
  assert.deepEqual(out, { v: 1, on: true, items: [{ title: 'Call the bank', dueAt: at(24) }, { title: 'Pay rent', dueAt: at(25) }] });
});

test('the window is local today up to, not including, three days on', () => {
  const [from, to] = todayWindow(NOW);
  assert.equal(from, at(24, 0));
  assert.equal(to, at(27, 0));
  const rows = [
    { title: 'before', dueAt: from - 1 },
    { title: 'start', dueAt: from },
    { title: 'last', dueAt: to - 1 },
    { title: 'end', dueAt: to },
  ];
  assert.deepEqual(parse(buildTodaySnapshot(rows, true, NOW)).items.map((i) => i.title), ['start', 'last']);
});

test('an item carries nothing but its title and due time', () => {
  const out = parse(buildTodaySnapshot([{ title: 'x', dueAt: at(24), body: 'secret', itemId: 'abc' } as never], true, NOW));
  assert.deepEqual(Object.keys(out.items[0]).sort(), ['dueAt', 'title']);
});

test('titles lose line breaks and control characters, are capped at 200 units, and blank ones are skipped', () => {
  assert.equal(cleanTitle('  Call\n the\tbank\u0007  now  '), 'Call the bank now');
  assert.equal(cleanTitle('a'.repeat(300)).length, 200);
  assert.equal(cleanTitle('a'.repeat(199) + '\u{1F600}'), 'a'.repeat(199)); // a split pair is dropped, not left half
  const rows = [{ title: ' \n\t ', dueAt: at(24) }, { title: '\u0000', dueAt: at(24) }, { title: 'Keep', dueAt: at(24) }];
  assert.deepEqual(parse(buildTodaySnapshot(rows, true, NOW)).items.map((i) => i.title), ['Keep']);
  assert.ok(!/[\u0000-\u001f]/.test(JSON.parse(JSON.stringify(cleanTitle('x\ny'))))); // nothing a reader would refuse
});

test('a due time that is not a whole number is left out', () => {
  const rows = [{ title: 'frac', dueAt: at(24) + 0.5 }, { title: 'nan', dueAt: Number.NaN }, { title: 'ok', dueAt: at(24) }];
  assert.deepEqual(parse(buildTodaySnapshot(rows, true, NOW)).items.map((i) => i.title), ['ok']);
});

test('at most 100 items, the soonest first', () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ title: `t${i}`, dueAt: at(24, 0) + (149 - i) * 60_000 }));
  const items = parse(buildTodaySnapshot(rows, true, NOW)).items;
  assert.equal(items.length, TODAY_MAX_ITEMS);
  assert.equal(items[0].title, 't149');
  assert.ok(items.every((it, i) => i === 0 || items[i - 1].dueAt <= it.dueAt));
});

test('the file never passes 64 KB, even with the widest characters', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ title: '中'.repeat(200), dueAt: at(24, 0) + i * 1000 }));
  const text = buildTodaySnapshot(rows, true, NOW);
  assert.ok(Buffer.byteLength(text) <= TODAY_MAX_BYTES, String(Buffer.byteLength(text)));
  assert.ok(parse(text).items.length > 80);
});

test('quick picks end the chosen local day', () => {
  assert.equal(dueFor('today', NOW), new Date(2026, 10, 24, 23, 59, 59, 999).getTime());
  assert.equal(dueFor('tomorrow', NOW), new Date(2026, 10, 25, 23, 59, 59, 999).getTime());
  assert.equal(dueFor('week', NOW), new Date(2026, 11, 1, 23, 59, 59, 999).getTime());
  assert.equal(startOfDay(dueFor('today', NOW) + 1), at(25, 0));
});

test('the due date reads in plain words', () => {
  assert.equal(dueText(dueFor('today', NOW), NOW), 'Due today');
  assert.equal(dueText(dueFor('tomorrow', NOW), NOW), 'Due tomorrow');
  assert.equal(dueText(dueFor('week', NOW), NOW), 'Due Tue 1 Dec');
  assert.equal(dueText(at(20), NOW), 'Was due Fri 20 Nov');
});
