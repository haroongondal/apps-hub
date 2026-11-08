import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportForChrome, formatCsv } from '../chrome-export.ts';
import { parseCsv } from '../csv.ts';
import type { Login } from '../entry.ts';

const login = (over: Partial<Login>): Login => ({
  type: 'login', name: 'n', username: 'u', password: 'p', sites: [], apps: [], note: '', updatedAt: 1, ...over,
});

test('formatCsv round-trips through parseCsv', () => {
  const cells = ['a,b', 'say "hi"', 'line1\nline2', 'اردو', ''];
  assert.deepEqual(parseCsv(formatCsv([cells])), [cells]);
});

test("exportForChrome writes Chrome's five columns", () => {
  assert.deepEqual(parseCsv(exportForChrome([]).csv)[0], ['name', 'url', 'username', 'password', 'note']);
});

test('one row per website', () => {
  const l = login({ name: 'Shop', username: 'me', password: 'pw', note: 'x', sites: [{ https: true, host: 'a.com' }, { https: false, host: 'b.org' }] });
  const out = exportForChrome([l]);
  assert.equal(out.rows, 2);
  assert.deepEqual(parseCsv(out.csv).slice(1), [
    ['Shop', 'https://a.com', 'me', 'pw', 'x'],
    ['Shop', 'http://b.org', 'me', 'pw', 'x'],
  ]);
});

test('logins with no website are left out and counted', () => {
  const out = exportForChrome([login({ sites: [] })]);
  assert.equal(out.rows, 0);
  assert.equal(out.leftOut, 1);
  assert.equal(parseCsv(out.csv).length, 1);
});

test('rows are sorted by name, case-insensitive', () => {
  const sites = [{ https: true, host: 'a.com' }];
  const out = exportForChrome([login({ name: 'b', sites }), login({ name: 'A', sites })]);
  assert.deepEqual(parseCsv(out.csv).slice(1).map((r) => r[0]), ['A', 'b']);
});
