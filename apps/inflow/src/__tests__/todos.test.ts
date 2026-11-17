import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Todo } from 'inflow-core';
import { dueInput, parseDue } from '../todos.ts';

// TZ is Asia/Karachi (UTC+5, no daylight saving) in the test script.
const KARACHI = 5 * 3600 * 1000;
const at = (y: number, month: number, d: number, h: number, min: number) => Date.UTC(y, month - 1, d, h, min) - KARACHI;

test('parseDue reads a date with a time, a date alone, or nothing', () => {
  assert.equal(parseDue('2026-11-20 09:30'), at(2026, 11, 20, 9, 30));
  assert.equal(parseDue('2026-11-20T09:30'), at(2026, 11, 20, 9, 30));
  assert.equal(parseDue('2026-1-5 7:05'), at(2026, 1, 5, 7, 5));
  assert.equal(parseDue('2026-11-20'), at(2026, 11, 20, 23, 59));
  assert.equal(parseDue('  '), null);
});

test('parseDue refuses what is not a real date', () => {
  for (const bad of ['tomorrow', '20-11-2026', '2026-13-01', '2026-02-30', '2026-11-20 25:00', '2026-11-20 9', '2026/11/20']) assert.equal(parseDue(bad), 'invalid', bad);
});

test('dueInput is the inverse of parseDue', () => {
  assert.equal(dueInput(null), '');
  assert.equal(dueInput(at(2026, 11, 20, 9, 5)), '2026-11-20 09:05');
  assert.equal(parseDue(dueInput(at(2026, 11, 20, 9, 5))), at(2026, 11, 20, 9, 5));
});

