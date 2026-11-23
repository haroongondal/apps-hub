import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describePlace, formatRadius } from '../places/describe.ts';

test('radii read as metres below a kilometre and in km above', () => {
  assert.equal(formatRadius(100), '100 m');
  assert.equal(formatRadius(250), '250 m');
  assert.equal(formatRadius(1000), '1 km');
  assert.equal(formatRadius(1500), '1.5 km');
});

test('a place reminder says when it fires and how close', () => {
  assert.equal(describePlace({ trigger: 'arrive', radiusM: 250 }), 'When I arrive, within 250 m');
  assert.equal(describePlace({ trigger: 'leave', radiusM: 1000 }), 'When I leave, within 1 km');
});
