import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, loopSeek, parseTime } from '../time.ts';

test('parseTime: seconds, m:ss and h:mm:ss', () => {
  assert.equal(parseTime('75'), 75);
  assert.equal(parseTime('1:05'), 65);
  assert.equal(parseTime('0:00'), 0);
  assert.equal(parseTime('75:00'), 4500);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime(' 1:05 '), 65, 'surrounding spaces are ignored');
});

test('parseTime: anything else is null', () => {
  for (const bad of ['', '  ', '1:5', '1:60', '1:02:60', '1:60:03', '-3', 'a', '1.5', '1:', ':05', '1:02:3', '9'.repeat(400)]) assert.equal(parseTime(bad), null, JSON.stringify(bad));
});

test('formatTime: floors, and shows hours only when there are some', () => {
  assert.equal(formatTime(5), '0:05');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(59.9), '0:59');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(-4), '0:00');
  assert.equal(formatTime(NaN), '0:00');
});

test('formatTime then parseTime returns the whole second', () => {
  for (const s of [0, 5, 59, 60, 65, 3599, 3600, 3723, 86399]) assert.equal(parseTime(formatTime(s)), s);
});

test('loopSeek: seeks back to the start just before the end', () => {
  const part = { start: 5, end: 10 };
  assert.equal(loopSeek(10, part, 60), 5);
  assert.equal(loopSeek(9.96, part, 60), 5);
  assert.equal(loopSeek(9.9, part, 60), null);
  assert.equal(loopSeek(3, part, 60), null);
});

test('loopSeek: the end is clamped to the duration', () => {
  assert.equal(loopSeek(59.97, { start: 5, end: 100 }, 60), 5);
  assert.equal(loopSeek(30, { start: 5, end: Infinity }, 60), null);
  assert.equal(loopSeek(30, { start: 5, end: 100 }, NaN), null, 'an unknown duration never loops');
});

test('loopSeek: no part, or an empty one, does nothing', () => {
  assert.equal(loopSeek(1, { start: 10, end: 5 }, 60), null);
  assert.equal(loopSeek(7, { start: 5, end: 5 }, 60), null);
  assert.equal(loopSeek(1, null, 60), null);
  assert.equal(loopSeek(5.4, { start: 5, end: 5.4 }, 60), null, 'a part under half a second is ignored');
  assert.equal(loopSeek(5.5, { start: 5, end: 5.5 }, 60), 5, 'half a second is the shortest part');
});
