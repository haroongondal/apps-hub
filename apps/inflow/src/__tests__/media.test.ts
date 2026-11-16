import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaCountLabel, mediaKindLabel, mediaStatsLabel, sizeLabel } from '../media.ts';

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

test('mediaStatsLabel reports files that were too big', () => {
  const base = { saved: 0, bytes: 0, unreadable: 0, tooBig: 0, lastMime: null };
  assert.equal(mediaStatsLabel({ ...base, tooBig: 1 }), 'No media saved yet. 1 file was too big.');
  assert.equal(mediaStatsLabel({ ...base, tooBig: 4 }), 'No media saved yet. 4 files were too big.');
  assert.equal(mediaStatsLabel({ ...base, saved: 2, bytes: 1_000_000, tooBig: 1 }), '2 files saved (1.0 MB). 1 too big.');
  assert.equal(mediaStatsLabel({ ...base, saved: 2, bytes: 1_000_000, unreadable: 2, tooBig: 3 }), '2 files saved (1.0 MB). 2 could not be read, 3 too big.');
});

test('mediaCountLabel comes from the count alone', () => {
  assert.equal(mediaCountLabel(1), 'Media');
  assert.equal(mediaCountLabel(3), '3 media files');
});
