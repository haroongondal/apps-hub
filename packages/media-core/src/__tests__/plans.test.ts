import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { planAudio } from '../audio.ts';
import { planClip } from '../clip.ts';
import { planConvert } from '../convert.ts';
import { planFrame } from '../frame.ts';
import { planReverse, reverseProblem } from '../reverse.ts';
import { planStabilize } from '../stabilize.ts';
import { parseLoudnorm, planVolume } from '../volume.ts';
import { planGif, nextGifAttempt } from '../gif.ts';
import { fromFfprobe } from '../probe.ts';
import { planQuality } from '../quality.ts';
import type { FfprobeJson } from '../probe.ts';
import type { GifPlan, MediaInfo } from '../types.ts';

const info = (name: string, file: string): MediaInfo =>
  fromFfprobe(JSON.parse(readFileSync(new URL(`../../fixtures/ffprobe/${name}.json`, import.meta.url), 'utf8')) as FfprobeJson, 'id', file);
const portrait = () => info('phone-portrait', 'IMG_0001.mp4');
const film = () => info('two-audio', 'Film.mkv');

test('clip: a lossless clip keeps the video and drops nothing the planner can copy', () => {
  const r = planClip(portrait(), 0.5, 1.5, 0, 'copy');
  assert.ok(r.ok);
  assert.equal(r.plan.ext, 'mp4');
  assert.deepEqual(r.plan.tracks, [0]);
  assert.equal(planClip(portrait(), 1.5, 0.5, 0, 'copy').ok, false);
});

test('clip: a MKV source stays MKV; the cut point is never after the start', () => {
  const r = planClip(film(), 1, 3, 1.5, 'copy');
  assert.ok(r.ok);
  assert.equal(r.plan.ext, 'mkv');
  assert.equal(r.plan.keyframeS, 1);
});

test('audio: each track is copied into the container that holds its codec', () => {
  const aac = planAudio(film().tracks[1]);
  assert.ok(aac.ok);
  assert.deepEqual([aac.plan.container, aac.plan.ext, aac.plan.mode], ['mp4', 'm4a', 'copy']);
  const ac3 = planAudio(film().tracks[2]);
  assert.ok(ac3.ok);
  assert.deepEqual([ac3.plan.container, ac3.plan.ext], ['raw', 'ac3']);
  assert.equal(planAudio(film().tracks[0]).ok, false);
});

test('gif: a clip over 60 s is refused; a fit-under-size GIF steps down the ladder, four tries at most', () => {
  assert.equal(planGif(portrait(), { startS: 0, endS: 61, width: 480, fps: 12 }).ok, false);
  const r = planGif(portrait(), { startS: 0, endS: 2, width: 480, fps: 12, targetBytes: 1000 });
  assert.ok(r.ok);
  const second = nextGifAttempt(r.plan, 2000);
  assert.ok(second.ok);
  assert.deepEqual([second.plan.width, second.plan.fps, second.plan.attempt], [360, 12, 2]);
  const fourth: GifPlan = { ...second.plan, width: 240, fps: 10, attempt: 4 };
  assert.deepEqual(nextGifAttempt(fourth, 2000), { ok: false, reason: 'gave-up' });
  assert.deepEqual(nextGifAttempt(second.plan, 900), { ok: true, plan: second.plan });
});

test('convert: a file whose codecs fit the new container is remuxed, not re-encoded', () => {
  const mp4 = planConvert(film(), 'mp4', { videoCodec: 'h264' });
  assert.ok(mp4.ok);
  assert.equal(mp4.plan.mode, 'remux');
  assert.deepEqual(mp4.plan.video, { encoder: 'copy', quality: 0 });
});

test('convert: WebM re-encodes to VP9 and Opus when the audio cannot be copied', () => {
  const webm = planConvert(film(), 'webm');
  assert.ok(webm.ok);
  assert.equal(webm.plan.mode, 'transcode');
  assert.deepEqual(webm.plan.video, { encoder: 'vp9', quality: 33 });
  assert.deepEqual(webm.plan.audio, { codec: 'opus', bps: 128_000, copy: false });
});

test('convert: an audio target takes the first audio track and encodes it when it is not already that codec', () => {
  const mp3 = planConvert(film(), 'mp3');
  assert.ok(mp3.ok);
  assert.equal(mp3.plan.mode, 'transcode');
  assert.deepEqual(mp3.plan.audio, { codec: 'mp3', bps: 192_000, copy: false });
  assert.equal(mp3.plan.video, undefined);
});

test('convert: muted drops every audio track and still remuxes a video whose codec fits', () => {
  const muted = planConvert(film(), 'mp4', { videoCodec: 'h264', muted: true });
  assert.ok(muted.ok);
  assert.equal(muted.plan.mode, 'remux');
  assert.equal(muted.plan.audio, undefined);
  assert.deepEqual(muted.plan.video, { encoder: 'copy', quality: 0 });
});

test('frame: a still needs a video track and keeps its time and format', () => {
  const still = planFrame(film(), 1.5, 'jpg');
  assert.deepEqual(still, { ok: true, plan: { tool: 'frame', timeS: 1.5, format: 'jpg', ext: 'jpg' } });
  const audioOnly: MediaInfo = { ...film(), tracks: film().tracks.filter(t => t.kind === 'audio') };
  assert.deepEqual(planFrame(audioOnly, 0, 'png'), { ok: false, reason: 'no-video' });
});

test('quality: the preset caps the short side and keeps the displayed orientation', () => {
  const small = planQuality(portrait(), 'small');
  assert.ok(small.ok);
  assert.deepEqual([small.plan.width, small.plan.height, small.plan.quality], [720, 1280, 45]);
  const high = planQuality(portrait(), 'high');
  assert.ok(high.ok);
  assert.deepEqual([high.plan.width, high.plan.height, high.plan.quality], [1080, 1920, 65]);
});

test('volume: the picture is copied when it fits MP4, re-encoded otherwise, and audio-only files give M4A', () => {
  const copy = planVolume(film(), 'normalize', 0);
  assert.deepEqual(copy, { ok: true, plan: { tool: 'volume', mode: 'normalize', gainDb: 0, video: 'copy', ext: 'mp4' } });
  const vp9 = { ...film(), tracks: film().tracks.map(t => t.kind === 'video' ? { ...t, codec: 'vp9' as const } : t) };
  const reencoded = planVolume(vp9, 'gain', 6);
  assert.deepEqual(reencoded, { ok: true, plan: { tool: 'volume', mode: 'gain', gainDb: 6, video: 'hw-h264', ext: 'mp4' } });
  const audioOnly = planVolume({ ...film(), tracks: film().tracks.filter(t => t.kind === 'audio') }, 'normalize', 0);
  assert.ok(audioOnly.ok);
  assert.equal(audioOnly.plan.ext, 'm4a');
  assert.equal(audioOnly.plan.video, undefined);
  assert.deepEqual(planVolume({ ...film(), tracks: film().tracks.filter(t => t.kind === 'video') }, 'normalize', 0),
    { ok: false, reason: 'invalid', detail: 'This file has no audio to change.' });
});

test('reverse: a clip up to 10 s at 1080p or below is planned; longer or bigger clips are refused with the reason', () => {
  assert.deepEqual(planReverse(film(), true), { ok: true, plan: { tool: 'reverse', sound: true, quality: 65, ext: 'mp4' } });
  assert.equal(reverseProblem({ ...film(), durationS: 10.02 }), undefined);
  assert.match(reverseProblem({ ...film(), durationS: 12 }) ?? '', /up to 10 seconds/);
  const uhd = { ...film(), tracks: film().tracks.map(t => t.kind === 'video' ? { ...t, width: 3840, height: 2160 } : t) };
  assert.match(reverseProblem(uhd) ?? '', /up to 1920×1080/);
  assert.deepEqual(planReverse({ ...film(), tracks: film().tracks.filter(t => t.kind === 'audio') }, true),
    { ok: false, reason: 'invalid', detail: 'Reverse needs a video track.' });
});

test('stabilize: each level maps to its search range, and an audio-only file is refused', () => {
  assert.deepEqual(planStabilize(film(), 'recommended'), { ok: true, plan: { tool: 'stabilize', level: 'recommended', search: 16, quality: 65, ext: 'mp4' } });
  const most = planStabilize(film(), 'most');
  const minimum = planStabilize(film(), 'minimum');
  assert.ok(most.ok && minimum.ok);
  assert.equal(most.plan.search, 40);
  assert.equal(minimum.plan.search, 8);
  assert.equal(planStabilize({ ...film(), tracks: film().tracks.filter(t => t.kind === 'audio') }, 'most').ok, false);
});

test('volume: the loudnorm measure is read from its JSON, and a missing field means no measure', () => {
  const stderr = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-31.45",\n\t"input_tp" : "-12.07",\n\t"input_lra" : "0.00",\n`
    + `\t"input_thresh" : "-41.45",\n\t"target_offset" : "0.33"\n}\n`;
  assert.deepEqual(parseLoudnorm(stderr), { inputI: -31.45, inputTp: -12.07, inputLra: 0, inputThresh: -41.45, offset: 0.33 });
  assert.equal(parseLoudnorm('no measure here'), undefined);
  assert.equal(parseLoudnorm(stderr.replace('"input_thresh" : "-41.45",', '')), undefined);
});
