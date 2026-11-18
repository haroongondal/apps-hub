import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noMatches, scanText } from '../photos/screen-text.ts';

test('scanText says the scan is waiting its turn while the row is queued', () => {
  assert.equal(scanText(0, 'queued', null), 'Waiting for other work to finish');
  assert.equal(scanText(1204, 'running', 0.37), 'Getting your photos ready · 37%');
  assert.equal(scanText(1204, undefined, null), '1,204 photos ready to search');
});

test('noMatches has its own words for More like this', () => {
  assert.deepEqual(noMatches(false), { title: 'No close matches', body: 'Try other words.' });
  assert.deepEqual(noMatches(true), { title: 'No close matches', body: 'No other photos look much like this one.' });
});
