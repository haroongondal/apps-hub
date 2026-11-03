import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSpec } from '../validate.ts';
import type { MediaInfo } from '../types.ts';

const clip: MediaInfo = {
  id: 'content://media/external/video/media/101', name: 'Trip.mp4', bytes: 120_000_000, durationS: 60, container: 'mp4',
  tracks: [{ index: 0, kind: 'video', codec: 'h264', width: 1920, height: 1080, fps: 30 }],
};
const spec = { tool: 'size', inputId: clip.id, targetBytes: 20_000_000, encoder: 'hw-h264' };

test('validate: a good size spec has no errors', () => {
  assert.deepEqual(validateSpec(spec, clip, 'android'), []);
});

test('validate: the input must still be the file that was picked', () => {
  assert.deepEqual(validateSpec({ ...spec, inputId: 'content://other' }, clip, 'android'),
    ['The file changed since you picked it. Pick it again.']);
});

test('validate: the target must be at least 1 MB and below the file size', () => {
  assert.deepEqual(validateSpec({ ...spec, targetBytes: 500_000 }, clip, 'android'), ['Pick a size of at least 1 MB.']);
  assert.deepEqual(validateSpec({ ...spec, targetBytes: 1.5e6 }, clip, 'android'), []);
  assert.deepEqual(validateSpec({ ...spec, targetBytes: 120_000_000 }, clip, 'android'),
    ["Pick a size below this file's size, which is 120.0 MB."]);
  assert.deepEqual(validateSpec({ ...spec, targetBytes: Number.NaN }, clip, 'android'), ['Pick a size of at least 1 MB.']);
});

test('validate: the phone has no x264 encoder', () => {
  assert.deepEqual(validateSpec({ ...spec, encoder: 'x264' }, clip, 'android'),
    ["This encoder isn't available on this phone."]);
  assert.deepEqual(validateSpec({ ...spec, encoder: 'x264' }, clip, 'mac'), []);
});

test('validate: an audio-only file is refused for a size job', () => {
  const audioOnly: MediaInfo = { ...clip, tracks: [{ index: 0, kind: 'audio', codec: 'aac', bitrate: 128000 }] };
  assert.deepEqual(validateSpec(spec, audioOnly, 'android'),
    ["This file has no video track, so it can't be compressed to a size. Use Extract audio instead."]);
});

test('validate: untrusted JSON is refused', () => {
  assert.notDeepEqual(validateSpec({ tool: 'size', inputId: 7 }, clip, 'android'), []);
  assert.deepEqual(validateSpec({ tool: 'nope', inputId: clip.id }, clip, 'android'), ["This job type isn't supported yet."]);
  assert.deepEqual(validateSpec(null, clip, 'android'), ["This job type isn't supported yet."]);
});
