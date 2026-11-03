import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fromFfprobe, normaliseCodec } from '../probe.ts';
import type { FfprobeJson } from '../probe.ts';

const fixture = (name: string): FfprobeJson =>
  JSON.parse(readFileSync(new URL(`../../fixtures/ffprobe/${name}.json`, import.meta.url), 'utf8'));

test('probe: a rotated phone clip reports its displayed size, not the stored size', () => {
  const info = fromFfprobe(fixture('phone-portrait'), 'id-1', 'IMG_0001.mp4');
  const video = info.tracks[0];
  assert.equal(info.container, 'mp4');
  assert.equal(video.codec, 'h264');
  assert.equal(video.rotation, 90);
  assert.equal([video.width, video.height].join('x'), '1080x1920');
  assert.equal(video.fps, 30);
  assert.ok(Math.abs(info.durationS - 2) < 0.01);
});

test('probe: tracks keep their stream index, codec and language', () => {
  const info = fromFfprobe(fixture('two-audio'), 'id-2', 'Film.mkv');
  assert.equal(info.container, 'mkv');
  assert.deepEqual(info.tracks.map(t => [t.index, t.kind, t.codec, t.language ?? '']), [
    [0, 'video', 'h264', ''], [1, 'audio', 'aac', 'fra'], [2, 'audio', 'ac3', 'eng'],
  ]);
  assert.equal(info.tracks[0].width, 1280);
  assert.equal(info.tracks[0].height, 720);
});

test('probe: PCM of any bit depth is one codec; unknown names are "other"', () => {
  assert.equal(normaliseCodec('pcm_s24le'), 'pcm');
  assert.equal(normaliseCodec('theora'), 'other');
});
