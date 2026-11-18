import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessFrom, IMAGES, SELECTED } from '../photos/access-map.ts';

test('accessFrom: all photos, only selected photos, asked again later, or blocked for good', () => {
  assert.equal(accessFrom({ [IMAGES]: 'granted', [SELECTED]: 'granted' }), 'all');
  assert.equal(accessFrom({ [IMAGES]: 'denied', [SELECTED]: 'granted' }), 'some');
  assert.equal(accessFrom({ [IMAGES]: 'denied', [SELECTED]: 'denied' }), 'none');
  assert.equal(accessFrom({ [IMAGES]: 'never_ask_again', [SELECTED]: 'never_ask_again' }), 'blocked');
  assert.equal(accessFrom({ [IMAGES]: 'never_ask_again', [SELECTED]: 'granted' }), 'some');
});
