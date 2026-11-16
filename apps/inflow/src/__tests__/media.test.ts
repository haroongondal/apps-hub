import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaKindLabel, mediaStatsLabel, sizeLabel } from '../media.ts';

test('sizeLabel uses B, KB and MB', () => {
  assert.equal(sizeLabel(12), '12 B');
  assert.equal(sizeLabel(340_000), '340 KB');
  assert.equal(sizeLabel(1_200_000), '1.2 MB');
});

test('mediaKindLabel names every kind in plain words', () => {
  assert.deepEqual(
    (['image', 'video', 'audio', 'document', 'sticker', 'other'] as const).map(mediaKindLabel),
    ['Photo', 'Video', 'Voice message', 'Document', 'Sticker', 'File'],
  );
});

test('mediaStatsLabel says nothing saved, or counts files and unreadable ones', () => {
  const base = { saved: 0, bytes: 0, unreadable: 0, tooBig: 0, lastMime: null };
  assert.equal(mediaStatsLabel(base), 'No media saved yet');
  assert.equal(mediaStatsLabel({ ...base, saved: 12, bytes: 3_400_000, unreadable: 2 }), '12 files saved (3.4 MB). 2 could not be read.');
  assert.equal(mediaStatsLabel({ ...base, saved: 1, bytes: 340_000 }), '1 file saved (340 KB).');
  assert.equal(mediaStatsLabel({ ...base, unreadable: 3 }), '0 files saved (0 B). 3 could not be read.');
});
