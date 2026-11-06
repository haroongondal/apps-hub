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

test('validate: a clip a tenth of a second long passes even when the subtraction comes out as 0.0999', () => {
  const part = (startS: number, endS: number) => ({ tool: 'clip', inputId: clip.id, startS, endS, mode: 'exact' });
  assert.deepEqual(validateSpec(part(2.2, 2.3), clip, 'android'), []);
  assert.deepEqual(validateSpec(part(5.6, 5.7), clip, 'android'), []);
  assert.equal(validateSpec(part(2.2, 2.2), clip, 'android').length, 1);
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

test('validate: a muted video conversion needs no audio, but a muted audio format is refused', () => {
  const av: MediaInfo = { ...clip, tracks: [...clip.tracks, { index: 1, kind: 'audio', codec: 'aac', channels: 2 }] };
  assert.deepEqual(validateSpec({ tool: 'convert', inputId: av.id, target: 'mp4', videoCodec: 'h264', muted: true }, av, 'mac'), []);
  assert.deepEqual(validateSpec({ tool: 'convert', inputId: av.id, target: 'mp3', videoCodec: 'h264', muted: true }, av, 'mac'),
    ['An audio format needs sound. Turn off Without sound or pick a video format.']);
  assert.deepEqual(validateSpec({ tool: 'convert', inputId: av.id, target: 'mp4', videoCodec: 'h264', muted: 'yes' }, av, 'mac'),
    ['Without sound must be on or off.']);
});

test('validate: a still frame needs a time inside the file and PNG or JPEG', () => {
  assert.deepEqual(validateSpec({ tool: 'frame', inputId: clip.id, timeS: 30, format: 'png' }, clip, 'mac'), []);
  assert.deepEqual(validateSpec({ tool: 'frame', inputId: clip.id, timeS: 60, format: 'png' }, clip, 'mac'), ['Pick a time inside the file.']);
  assert.deepEqual(validateSpec({ tool: 'frame', inputId: clip.id, timeS: -1, format: 'png' }, clip, 'mac'), ['Pick a time inside the file.']);
  assert.deepEqual(validateSpec({ tool: 'frame', inputId: clip.id, timeS: 1, format: 'gif' }, clip, 'mac'), ['Pick PNG or JPEG.']);
});

test('validate: volume needs audio and a gain inside the limit, reverse needs a short clip and stabilize needs video', () => {
  const av: MediaInfo = { ...clip, durationS: 8, tracks: [...clip.tracks, { index: 1, kind: 'audio', codec: 'aac', channels: 2 }] };
  assert.deepEqual(validateSpec({ tool: 'volume', inputId: av.id, mode: 'normalize', gainDb: 0 }, av, 'mac'), []);
  assert.deepEqual(validateSpec({ tool: 'volume', inputId: av.id, mode: 'gain', gainDb: 21 }, av, 'mac'), ['Pick a change from -20 to +20 dB.']);
  assert.deepEqual(validateSpec({ tool: 'volume', inputId: clip.id, mode: 'normalize', gainDb: 0 }, clip, 'mac'), ['This file has no audio to change.']);
  assert.deepEqual(validateSpec({ tool: 'reverse', inputId: av.id, sound: true }, av, 'mac'), []);
  assert.match(validateSpec({ tool: 'reverse', inputId: clip.id, sound: true }, clip, 'mac')[0], /up to 10 seconds/);
  assert.deepEqual(validateSpec({ tool: 'reverse', inputId: av.id, sound: 'yes' }, av, 'mac'), ['Reverse the sound on or off.']);
  assert.deepEqual(validateSpec({ tool: 'stabilize', inputId: av.id, level: 'most' }, av, 'mac'), []);
  assert.deepEqual(validateSpec({ tool: 'stabilize', inputId: av.id, level: 'extreme' }, av, 'mac'), ['Pick Minimum cut, Recommended or Most stable.']);
});
