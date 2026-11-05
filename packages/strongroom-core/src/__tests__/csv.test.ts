import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../csv.ts';

test('quoted commas, quotes and newlines stay inside their cell', () => {
  assert.deepEqual(parseCsv('"a,b","say ""hi""","line1\nline2"\n'), [['a,b', 'say "hi"', 'line1\nline2']]);
});

test('a BOM and CRLF line endings are handled', () => {
  assert.deepEqual(parseCsv('﻿name,url\r\nx,y\r\n'), [['name', 'url'], ['x', 'y']]);
});

test('LF endings and a missing final newline are handled', () => {
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('empty cells and a trailing comma are kept', () => {
  assert.deepEqual(parseCsv('a,,c\n,\n'), [['a', '', 'c'], ['', '']]);
  assert.deepEqual(parseCsv('a,'), [['a', '']]);
});

test('a blank line is one empty cell', () => {
  assert.deepEqual(parseCsv('a\r\n\r\nb\r\n'), [['a'], [''], ['b']]);
});

test('empty input has no records', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('﻿'), []);
});

test('CRLF inside quotes is kept', () => {
  assert.deepEqual(parseCsv('"x\r\ny",z\r\n'), [['x\r\ny', 'z']]);
});

test('a stray quote inside an unquoted cell is literal and does not throw', () => {
  assert.deepEqual(parseCsv('5" pipe,"a"b,c'), [['5" pipe', 'ab', 'c']]);
});

test('a quoted field that never ends throws', () => {
  for (const bad of ['a,"b', '"', 'a,"b""', '"x\ny,z\n']) assert.throws(() => parseCsv(bad), bad);
});
