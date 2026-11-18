import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brands } from '@apps-hub/ui/tokens';

test('Halo brand is named Halo with hue 190', () => {
  assert.equal(brands.halo.name, 'Halo');
  assert.equal(brands.halo.hue, 190);
});
