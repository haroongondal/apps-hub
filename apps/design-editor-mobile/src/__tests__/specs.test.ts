import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MediaInfo } from '@apps-hub/media-core';
import { specsFor, type Options } from '../media/specs.ts';
import { correctionFrom, timeText } from '../media/tools.ts';

const base: Options = {
  targetBytes: 20_000_000, how: 'size', quality: 'medium', smaller: false, cut: 'copy', skippedSounds: {},
  gifWidth: 480, gifFps: 12, gifMb: '', kind: 'video', muted: false, format: 'png', louder: 'even', withSound: true, level: 'recommended',
};
const file = (id: string, audio: number[]): MediaInfo => ({
  id, name: `${id}.mp4`, bytes: 1, durationS: 10, container: 'mp4',
  tracks: [{ index: 0, kind: 'video', codec: 'h264' }, ...audio.map(index => ({ index, kind: 'audio' as const, codec: 'aac' as const }))],
});

test('Remove the sound does not follow a person into Sound only', () => {
  const [spec] = specsFor('format', file('a', [1]), { ...base, kind: 'sound', muted: true });
  assert.equal(spec.tool === 'convert' && spec.muted, false);
  const [video] = specsFor('format', file('a', [1]), { ...base, kind: 'video', muted: true });
  assert.equal(video.tool === 'convert' && video.muted, true);
});

test('Get the sound saves every sound of every file unless one is turned off, and each file keeps its own choice', () => {
  const b = file('b', [1, 2]), a = file('a', [1]);
  assert.deepEqual(specsFor('sound', b, base).map(s => s.tool === 'audio' && s.trackIndex), [1, 2]);
  const skip = { ...base, skippedSounds: { b: [2] } };
  assert.deepEqual(specsFor('sound', b, skip).map(s => s.tool === 'audio' && s.trackIndex), [1]);
  assert.deepEqual(specsFor('sound', a, skip).map(s => s.tool === 'audio' && s.trackIndex), [1]);
  assert.deepEqual(specsFor('sound', file('c', []), base), []);
});

test('time text never shows sixty seconds', () => {
  assert.equal(timeText(59.97), '1:00.0');
  assert.equal(timeText(119.97), '2:00.0');
  assert.equal(timeText(12.4), '0:12.4');
  assert.equal(timeText(-1), '0:00.0');
});

test('the size correction follows the native rule: the last five, their median, kept from 0.8 to 1.5', () => {
  assert.equal(correctionFrom([]), 1);
  assert.equal(correctionFrom([1.1, 1.3]), 1.2000000000000002);
  assert.equal(correctionFrom([9, 1.0, 1.1, 1.2, 1.3, 1.4]), 1.2); // the oldest value is dropped
  assert.equal(correctionFrom([2, 3, 4]), 1.5);
  assert.equal(correctionFrom([0.1]), 0.8);
});
