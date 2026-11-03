import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ffmpegArgs, loudnormMeasureArgs, parseKeyframe, parseProgress } from '../ffmpeg.ts';
import type { ClipPlan, ConvertPlan, GifPlan, QualityPlan, SizePlan } from '../types.ts';

const size: SizePlan = {
  tool: 'size', targetBytes: 20_000_000, encoder: 'x264', rung: { shortSide: 720, fps: 30 }, width: 1280, height: 720,
  videoBps: 2_236_595, audio: { mode: 'copy' }, overheadBytes: 265_536, plannedVideoBytes: 16_000_000, plannedBytes: 18_000_000,
  attempt: 1, margin: 0.97, fpsCap: 30,
};

test('ffmpeg: the two-pass size job runs pass 1 to nowhere and pass 2 to the output', () => {
  const p1 = ffmpegArgs(size, 'in.mp4', 'out.mp4', { n: 1, log: '/t/x264' });
  assert.ok(p1.includes('-pass') && p1[p1.indexOf('-pass') + 1] === '1');
  assert.equal(p1.at(-1), '/dev/null');
  const p2 = ffmpegArgs(size, 'in.mp4', '/t/out.mp4', { n: 2, log: '/t/x264' });
  assert.equal(p2[p2.indexOf('-pass') + 1], '2');
  assert.equal(p2.at(-1), '/t/out.mp4');
  assert.ok(p2.includes('libx264') && p2.includes('-c:a') && p2[p2.indexOf('-c:a') + 1] === 'copy');
});

test('ffmpeg: a hardware HEVC size job is one pass and tags hvc1 for Apple players', () => {
  const args = ffmpegArgs({ ...size, encoder: 'hw-hevc' }, 'in.mp4', 'out.mp4');
  assert.ok(args.includes('hevc_videotoolbox'));
  assert.equal(args[args.indexOf('-tag:v') + 1], 'hvc1');
  assert.ok(!args.includes('-pass'));
});

test('ffmpeg: a lossless clip starts at the keyframe and copies every kept track', () => {
  const clip: ClipPlan = { tool: 'clip', mode: 'copy', startS: 13, endS: 43, keyframeS: 12.4, container: 'mp4', ext: 'mp4', tracks: [0, 1, 2] };
  const args = ffmpegArgs(clip, 'in.mp4', 'out.mp4');
  assert.equal(args[args.indexOf('-ss') + 1], '12.400000');
  assert.equal(args[args.indexOf('-t') + 1], '30.600000');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '-map'), ['0:0', '0:1', '0:2']);
  assert.equal(args[args.indexOf('-c') + 1], 'copy');
});

test('ffmpeg: quality uses VideoToolbox at the preset quality', () => {
  const q: QualityPlan = { tool: 'quality', encoder: 'hw-h264', rung: { shortSide: 720, fps: 30 }, width: 1280, height: 720, quality: 45 };
  const args = ffmpegArgs(q, 'in.mp4', 'out.mp4');
  assert.equal(args[args.indexOf('-q:v') + 1], '45');
  assert.ok(args.includes('h264_videotoolbox'));
});

test('ffmpeg: GIFs use one filter graph with a palette and no audio', () => {
  const gif: GifPlan = { tool: 'gif', startS: 1, endS: 7, width: 480, fps: 12, attempt: 1 };
  const args = ffmpegArgs(gif, 'in.mp4', 'out.gif');
  assert.match(args[args.indexOf('-filter_complex') + 1], /palettegen=stats_mode=diff.*paletteuse/);
  assert.ok(args.includes('-an'));
});

test('ffmpeg: WebM transcodes video to VP9 and audio to Opus', () => {
  const convert: ConvertPlan = {
    tool: 'convert', mode: 'transcode', container: 'webm', ext: 'webm',
    video: { encoder: 'vp9', quality: 33 }, audio: { codec: 'opus', bps: 128_000, copy: false },
  };
  const args = ffmpegArgs(convert, 'in.mkv', 'out.webm');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libvpx-vp9');
  assert.equal(args[args.indexOf('-c:a') + 1], 'libopus');
});

test('ffmpeg: progress reads out_time_us and the end marker, and ignores N/A', () => {
  assert.deepEqual(parseProgress('out_time_us=1500000\nprogress=continue\n'), { outTimeUs: 1_500_000, end: false });
  assert.deepEqual(parseProgress('out_time_us=N/A\nprogress=end\n'), { outTimeUs: undefined, end: true });
});

test('ffmpeg: the cut point is the last keyframe at or before the time', () => {
  assert.equal(parseKeyframe('0.000000,\n2.000000,\n4.000000,\n', 3.5), 2);
  assert.equal(parseKeyframe('0.000000\n2.000000\n4.000000\n', 3.5), 2);
  assert.equal(parseKeyframe('', 3.5), 0);
});

test('ffmpeg: a muted convert maps no audio stream', () => {
  const args = ffmpegArgs({ tool: 'convert', mode: 'remux', container: 'mp4', ext: 'mp4', video: { encoder: 'copy', quality: 0 } }, 'in.mp4', 'out.mp4');
  assert.ok(!args.includes('0:a?') && !args.includes('-c:a'));
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2), ['-map', '0:v?']);
});

test('ffmpeg: a still frame is one video frame, with JPEG quality 2 only for JPEG', () => {
  const png = ffmpegArgs({ tool: 'frame', timeS: 12.5, format: 'png', ext: 'png' }, 'in.mp4', 'out.png');
  assert.equal(png[png.indexOf('-ss') + 1], '12.500');
  assert.equal(png[png.indexOf('-frames:v') + 1], '1');
  assert.ok(png.includes('-an') && !png.includes('-q:v'));
  assert.equal(png.at(-1), 'out.png');
  const jpg = ffmpegArgs({ tool: 'frame', timeS: 0, format: 'jpg', ext: 'jpg' }, 'in.mp4', 'out.jpg');
  assert.equal(jpg[jpg.indexOf('-q:v') + 1], '2');
});

test('ffmpeg: volume normalises to -23 LUFS or adds a gain, copies the picture when it can, and keeps M4A for audio-only', () => {
  const norm = ffmpegArgs({ tool: 'volume', mode: 'normalize', gainDb: 0, video: 'copy', ext: 'mp4' }, 'in.mp4', 'out.mp4');
  assert.equal(norm[norm.indexOf('-af') + 1], 'loudnorm=I=-23:LRA=11:TP=-1.5');
  assert.equal(norm[norm.indexOf('-c:v') + 1], 'copy');
  const gain = ffmpegArgs({ tool: 'volume', mode: 'gain', gainDb: -3.5, video: 'hw-h264', ext: 'mp4' }, 'in.mkv', 'out.mp4');
  assert.equal(gain[gain.indexOf('-af') + 1], 'volume=-3.5dB');
  assert.equal(gain[gain.indexOf('-c:v') + 1], 'h264_videotoolbox');
  const audio = ffmpegArgs({ tool: 'volume', mode: 'gain', gainDb: 2, ext: 'm4a' }, 'in.mp4', 'out.m4a');
  assert.ok(audio.includes('-vn') && !audio.includes('-c:v'));
});

test('ffmpeg: reverse runs the video and, when asked, the sound backwards; without sound it drops the audio', () => {
  const withSound = ffmpegArgs({ tool: 'reverse', sound: true, quality: 65, ext: 'mp4' }, 'in.mp4', 'out.mp4');
  assert.equal(withSound[withSound.indexOf('-vf') + 1], 'reverse');
  assert.equal(withSound[withSound.indexOf('-af') + 1], 'areverse');
  const silent = ffmpegArgs({ tool: 'reverse', sound: false, quality: 65, ext: 'mp4' }, 'in.mp4', 'out.mp4');
  assert.ok(silent.includes('-an') && !silent.includes('areverse'));
});

test('ffmpeg: stabilize uses deshake with the level search range and mirrored edges, so the frame keeps its size', () => {
  const args = ffmpegArgs({ tool: 'stabilize', level: 'most', search: 40, quality: 65, ext: 'mp4' }, 'in.mp4', 'out.mp4');
  assert.equal(args[args.indexOf('-vf') + 1], 'deshake=rx=40:ry=40:edge=mirror');
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_videotoolbox');
});

test('ffmpeg: a measured normalize runs the second pass linearly with the measured values', () => {
  const measured = { inputI: -31.45, inputTp: -12.07, inputLra: 0, inputThresh: -41.45, offset: 0.33 };
  const args = ffmpegArgs({ tool: 'volume', mode: 'normalize', gainDb: 0, video: 'copy', ext: 'mp4', measured }, 'in.mp4', 'out.mp4');
  const af = args[args.indexOf('-af') + 1];
  assert.equal(af, 'loudnorm=I=-23:LRA=11:TP=-1.5:measured_I=-31.45:measured_TP=-12.07:measured_LRA=0:measured_thresh=-41.45:offset=0.33:linear=true');
  const measure = loudnormMeasureArgs('in.mp4');
  assert.equal(measure[measure.indexOf('-af') + 1], 'loudnorm=I=-23:LRA=11:TP=-1.5:print_format=json');
  assert.deepEqual(measure.slice(-3), ['-f', 'null', '-']);
});
