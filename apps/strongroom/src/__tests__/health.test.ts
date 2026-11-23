import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HealthReport, Row } from 'strongroom-vault';
import { REASONS, sections, summary } from '../health.ts';

const rows: Row[] = [
  { id: 'a', type: 'login', name: 'Bank', subtitle: 'me@bank.com' },
  { id: 'b', type: 'login', name: 'Mail', subtitle: 'me@mail.com' },
  { id: 'c', type: 'login', name: 'Shop', subtitle: 'me' },
  { id: 'd', type: 'login', name: '', subtitle: 'you' },
  { id: 'e', type: 'login', name: 'Forum', subtitle: 'me' },
];

const report: HealthReport = {
  checked: 6,
  weak: 2,
  reused: 4,
  common: 1,
  items: [
    { id: 'e', flags: ['reused'], group: 2 },
    { id: 'd', flags: ['short', 'digits', 'common'], group: 0 },
    { id: 'b', flags: ['reused', 'name'], group: 1 },
    { id: 'a', flags: ['reused'], group: 1 },
    { id: 'c', flags: ['reused'], group: 2 },
    { id: 'gone', flags: ['reused'], group: 1 },
  ],
};

test('the summary counts in plain words', () => {
  assert.equal(summary(report), 'Checked 6 passwords: 4 used on more than one login, 2 easy to guess, 1 well known.');
  assert.equal(summary({ checked: 1, weak: 0, reused: 0, common: 0, items: [] }), 'Checked 1 password. Nothing needs changing.');
  assert.equal(summary({ checked: 0, weak: 0, reused: 0, common: 0, items: [] }), 'You have no saved passwords to check yet.');
});

test('reused logins are grouped, then easy-to-guess with reasons, then well known, in the vault list order', () => {
  const s = sections(report, rows);
  assert.deepEqual(s.map((x) => x.key), ['group-1', 'group-2', 'weak', 'common']);
  assert.deepEqual(s[0]!.rows.map((r) => r.id), ['a', 'b']);
  assert.equal(s[0]!.title, 'Same password on 2 logins');
  assert.equal(s[0]!.footer, undefined);
  assert.ok(s[1]!.footer);
  assert.deepEqual(s[2]!.rows, [
    { id: 'b', title: 'Mail', subtitle: REASONS.name },
    { id: 'd', title: 'Untitled', subtitle: `${REASONS.short} · ${REASONS.digits}` },
  ]);
  assert.deepEqual(s[3]!.rows.map((r) => r.id), ['d']);
});

test('nothing flagged gives no sections', () => {
  assert.deepEqual(sections({ checked: 3, weak: 0, reused: 0, common: 0, items: [] }, rows), []);
});
