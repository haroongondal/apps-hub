import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allText, pickLine, type OcrLine } from '../pick.ts';

const a: OcrLine = { text: 'Hello world', left: 10, top: 10, right: 210, bottom: 40 };
const b: OcrLine = { text: 'Second line', left: 10, top: 50, right: 210, bottom: 80 };

test('a point inside a line picks it', () => assert.equal(pickLine([a, b], 100, 25), a));
test('a point just outside still picks the nearest line, within half a line height', () => {
  assert.equal(pickLine([a, b], 100, 44), a);
  assert.equal(pickLine([a, b], 100, 47), b);
});
test('a point far from every line picks nothing', () => assert.equal(pickLine([a, b], 100, 200), null));
test('no lines picks nothing', () => assert.equal(pickLine([], 1, 1), null));
test('allText drops empty lines and trims', () =>
  assert.equal(allText([a, { ...b, text: '   ' }, { ...b, text: ' Two ' }]), 'Hello world\nTwo'));
