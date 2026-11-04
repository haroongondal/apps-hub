import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAudio } from '../audio.ts';
import { planClip } from '../clip.ts';
import { planConvert } from '../convert.ts';
import { formatClock, formatMb } from '../format.ts';
import { planQuality } from '../quality.ts';
import { visibleQueue } from '../queue.ts';
import { androidContainerFor, canRemux } from '../remux.ts';
import type { Codec, Job, JobState, MediaInfo } from '../types.ts';

const file = (video: Codec, audio: Codec[]): MediaInfo => ({
  id: 'content://x', name: 'a.mp4', bytes: 50_000_000, durationS: 60, container: 'mp4',
  tracks: [
    { index: 0, kind: 'video', codec: video, width: 1080, height: 1920, fps: 30, rotation: 0 },
    ...audio.map((codec, i) => ({ index: i + 1, kind: 'audio' as const, codec, channels: 2 })),
  ],
});

const job = (id: string, state: JobState, finishedAt?: number): Job => ({
  id, inputId: 'x', inputName: id, plan: { tool: 'frame', timeS: 0, format: 'png', ext: 'png' }, state, progress: 0, attempt: 1, outputs: [], finishedAt,
});

test('queue: twelve jobs show five, running first, then waiting, then the newest finished (AC-15)', () => {
  const jobs = [
    ...Array.from({ length: 6 }, (_, i) => job(`done${i}`, 'done', 100 + i)),
    job('failed', 'failed', 200),
    job('wait1', 'queued'), job('wait2', 'queued'), job('wait3', 'queued'),
    job('run', 'running'), job('cancelled', 'cancelled', 150),
  ];
  const { shown, hidden } = visibleQueue(jobs, 5);
  assert.deepEqual(shown.map(j => j.id), ['run', 'wait1', 'wait2', 'wait3', 'failed']);
  assert.equal(hidden, 7);
  assert.deepEqual(visibleQueue(jobs.slice(0, 3), 5), { shown: jobs.slice(0, 3).reverse(), hidden: 0 });
});

test('queue: a paused or interrupted job sits with the waiting ones so it can be resumed', () => {
  const { shown } = visibleQueue([job('d', 'done', 5), job('p', 'paused'), job('i', 'interrupted')], 5);
  assert.deepEqual(shown.map(j => j.id), ['p', 'i', 'd']);
});

test('format: sizes in MB and times as m:ss', () => {
  assert.equal(formatMb(18_040_000), '18.0 MB');
  assert.equal(formatMb(135_700_000), '136 MB');
  assert.equal(formatClock(65.4), '1:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-3), '0:00');
});

test('remux: MediaMuxer takes AAC into MP4 and Opus into WebM, nothing mixed', () => {
  assert.equal(androidContainerFor(file('h264', ['aac'])), 'mp4');
  assert.equal(androidContainerFor(file('vp9', ['opus'])), 'webm');
  assert.equal(androidContainerFor(file('h264', ['ac3'])), undefined);
  assert.equal(canRemux(file('h264', ['opus'])), false);
});

test('clip on the phone: a lossless cut needs a copyable file, an exact cut always works', () => {
  const lossless = planClip(file('h264', ['aac', 'aac']), 1, 5, 0.5, 'copy', 'android');
  assert.ok(lossless.ok);
  assert.equal(lossless.plan.ext, 'mp4');
  const refused = planClip(file('h264', ['ac3']), 1, 5, 0.5, 'copy', 'android');
  assert.equal(refused.ok, false);
  const exact = planClip(file('h264', ['ac3']), 1, 5, 1, 'exact', 'android');
  assert.ok(exact.ok);
  assert.equal(exact.plan.ext, 'mp4');
});

test('audio on the phone: copy what MediaMuxer can hold, raw frames for MP3, else AAC', () => {
  const t = (codec: Codec) => ({ index: 1, kind: 'audio' as const, codec });
  const modes = (codec: Codec) => { const r = planAudio(t(codec), 'android'); assert.ok(r.ok); return [r.plan.mode, r.plan.ext]; };
  assert.deepEqual(modes('aac'), ['copy', 'm4a']);
  assert.deepEqual(modes('opus'), ['copy', 'opus']);
  assert.deepEqual(modes('mp3'), ['raw', 'mp3']);
  assert.deepEqual(modes('pcm'), ['wav', 'wav']);
  assert.deepEqual(modes('flac'), ['aac', 'm4a']);
});

test('convert on the phone: MP4 and M4A only, copying when every track fits', () => {
  const same = planConvert(file('h264', ['aac']), 'mp4', {}, 'android');
  assert.ok(same.ok);
  assert.equal(same.plan.mode, 'remux');
  const hevc = planConvert(file('h264', ['aac']), 'mp4', { videoCodec: 'hevc' }, 'android');
  assert.ok(hevc.ok && hevc.plan.mode === 'transcode' && hevc.plan.video?.encoder === 'hw-hevc');
  const muted = planConvert(file('h264', ['ac3']), 'mp4', { muted: true }, 'android');
  assert.ok(muted.ok && muted.plan.mode === 'remux' && muted.plan.audio === undefined);
  assert.equal(planConvert(file('h264', ['aac']), 'mkv', {}, 'android').ok, false);
  const m4a = planConvert(file('h264', ['mp3']), 'm4a', {}, 'android');
  assert.ok(m4a.ok && m4a.plan.mode === 'transcode');
});

test('quality on the phone: bitrate per pixel, not a VideoToolbox number', () => {
  const r = planQuality(file('h264', ['aac']), 'small', 'android');
  assert.ok(r.ok);
  assert.equal(r.plan.quality, 0.07);
  assert.equal(r.plan.height, 1280);
});

import { planFor } from '../plan-for.ts';
import { refusalText } from '../format.ts';

test('planFor: one entry for every tool, with the phone tables and a plain refusal', () => {
  const f = file('h264', ['aac']);
  const ctx = { platform: 'android' as const, keyframeS: 4 };
  const clip = planFor({ tool: 'clip', inputId: f.id, startS: 5, endS: 9, mode: 'copy' }, f, ctx);
  assert.ok(clip.ok && clip.plan.tool === 'clip' && clip.plan.keyframeS === 4);
  const bad = planFor({ tool: 'frame', inputId: f.id, timeS: 99, format: 'png' }, f, ctx);
  assert.ok(!bad.ok && bad.reason === 'invalid' && /inside the file/.test(bad.detail ?? ''));
  const long = { ...f, durationS: 1800, bytes: 900_000_000 };
  const size = planFor({ tool: 'size', inputId: f.id, targetBytes: 20_000_000, encoder: 'hw-h264' }, long, ctx);
  assert.ok(!size.ok);
  assert.match(refusalText(size, 20_000_000), /Couldn't fit under 20 MB/);
  assert.doesNotMatch(refusalText(size, 20_000_000), /bitrate|codec|encoder/i);
});

test('refusal text: seconds for a short limit, minutes for a long one, and the size as the person typed it', () => {
  assert.match(refusalText({ ok: false, reason: 'too-long', maxDurationS: 40 }, 20_000_000), /about 40 seconds/);
  assert.match(refusalText({ ok: false, reason: 'too-long', maxDurationS: 1297 }, 20_000_000), /about 21 minutes/);
  assert.match(refusalText({ ok: false, reason: 'too-long', maxDurationS: 1297 }, 1_500_000), /under 1\.5 MB/);
});
