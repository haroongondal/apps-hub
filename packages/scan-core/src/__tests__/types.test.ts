import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Quad, ScanPage, SessionInput } from '../index.ts';

// The contract compiles and a session round-trips through JSON; stream C replaces this file's job
// with real tests and removes it from the `test` script when it has its own.
test('a session input is plain JSON', () => {
  const quad: Quad = [0, 0, 1, 0, 1, 1, 0, 1];
  const input: SessionInput = {
    folderId: null,
    appendTo: null,
    mode: 'card',
    sheet: true,
    pages: [{ file: '/x/cap-1.jpg', quad, rotation: 0, filter: 'auto', side: 'front' }],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
  const page: Pick<ScanPage, 'kind'> = { kind: 'sheet' };
  assert.equal(page.kind, 'sheet');
});
