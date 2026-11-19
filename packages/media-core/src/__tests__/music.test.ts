import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { planMusic } from '../music.ts';
import { ffmpegArgs } from '../ffmpeg.ts';
import { validateSpec } from '../validate.ts';
import { fromFfprobe } from '../probe.ts';
import type { FfprobeJson } from '../probe.ts';
import type { MediaInfo, MusicPlan } from '../types.ts';

const info = (name: string, file: string): MediaInfo =>
  fromFfprobe(JSON.parse(readFileSync(new URL(`../../fixtures/ffprobe/${name}.json`, import.meta.url), 'utf8')) as FfprobeJson, 'clip', file);
const silent = () => info('phone-portrait', 'IMG_0001.mp4');
const withSound = () => info('two-audio', 'Film.mkv');
const song: MediaInfo = {
  id: 'song', name: 'track.mp3', bytes: 3_000_000, durationS: 200, container: 'mp3',
  tracks: [{ index: 0, kind: 'audio', codec: 'mp3' }],
};
const planOf = (r: ReturnType<typeof planMusic>): MusicPlan => {
  assert.ok(r.ok);
  return r.plan as MusicPlan;
};

test('music: mix keeps the clip sound, replace drops it, and a silent clip gets the song alone', () => {
  const mix = planOf(planMusic(withSound(), song, 'mix', -6));
  assert.equal(mix.mix, true);
  assert.equal(mix.gainDb, -6);
  assert.equal(planOf(planMusic(withSound(), song, 'replace', 0)).mix, false);
  assert.equal(planOf(planMusic(silent(), song, 'mix', 0)).mix, false);
});

test('music: the clip length is the cut point and the output is MP4', () => {
  const plan = planOf(planMusic(withSound(), song, 'mix', 0));
  assert.equal(plan.durationS, withSound().durationS);
  assert.equal(plan.ext, 'mp4');
});

test('music: refuses a song with no audio and a clip with no video', () => {
  const noAudio: MediaInfo = { ...song, tracks: [] };
  assert.deepEqual(planMusic(withSound(), noAudio, 'mix', 0), { ok: false, reason: 'invalid', detail: 'The song file has no audio.' });
  const audioOnly: MediaInfo = { ...withSound(), tracks: withSound().tracks.filter(t => t.kind === 'audio') };
  assert.deepEqual(planMusic(audioOnly, song, 'mix', 0), { ok: false, reason: 'no-video' });
});

test('ffmpeg: mix sums the two sounds with amix at their own levels and cuts at the clip length', () => {
  const plan = planOf(planMusic(withSound(), song, 'mix', -3));
  const args = ffmpegArgs(plan, 'in.mkv', 'out.mp4', undefined, 'track.mp3');
  assert.equal(args[args.indexOf('-filter_complex') + 1], '[1:a]volume=-3dB[m];[0:a:0][m]amix=inputs=2:duration=first:normalize=0[a]');
  const first = args.indexOf('-i');
  assert.deepEqual(args.slice(first, first + 4), ['-i', 'in.mkv', '-i', 'track.mp3']);
  assert.equal(args[args.indexOf('-t') + 1], withSound().durationS.toFixed(3));
});

test('ffmpeg: replace takes only the song, with no amix', () => {
  const args = ffmpegArgs(planOf(planMusic(withSound(), song, 'replace', 0)), 'in.mkv', 'out.mp4', undefined, 'track.mp3');
  assert.equal(args[args.indexOf('-filter_complex') + 1], '[1:a]volume=0dB[a]');
  assert.ok(!args.some(a => a.includes('amix')));
});

test('validate: music needs a song, a mode and a gain inside the limit, and runs on the Mac only', () => {
  const base = { tool: 'music', inputId: 'clip', musicInputId: 'song', mode: 'mix', gainDb: 0 };
  assert.deepEqual(validateSpec(base, withSound(), 'mac'), []);
  assert.deepEqual(validateSpec({ ...base, musicInputId: '' }, withSound(), 'mac'), ['Pick a song first.']);
  assert.deepEqual(validateSpec({ ...base, mode: 'loop' }, withSound(), 'mac'), ['Pick Mix or Replace.']);
  assert.equal(validateSpec({ ...base, gainDb: 21 }, withSound(), 'mac').length, 1);
  assert.equal(validateSpec(base, withSound(), 'android').length, 1);
  // A silent clip is fine: the song is the only sound.
  assert.deepEqual(validateSpec(base, silent(), 'mac'), []);
});
