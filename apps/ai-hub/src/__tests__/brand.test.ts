import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND } from '../brand.ts';

test('the app uses the aihub brand', () => {
  assert.equal(BRAND, 'aihub');
});
