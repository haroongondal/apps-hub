import { _electron } from 'playwright-core';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const bin = new URL('../vendor/ffmpeg/', import.meta.url).pathname;
if (!fs.existsSync(bin + 'ffmpeg')) {
  console.log('media e2e skipped: vendor/ffmpeg is missing. Run pnpm --filter design-editor ffmpeg, then run this again.');
  process.exit(0);
}
const out = new URL('out/media/', import.meta.url).pathname;
const folder = path.join(out, 'results');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(folder, { recursive: true });

const ff = args => execFileSync(bin + 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = file => JSON.parse(execFileSync(bin + 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MB = 1e6;
// Measurements straight from FFmpeg: integrated loudness (EBU R128), mean volume, and frame-to-frame difference (lower is steadier).
const lufs = file => {
  const r = spawnSync(bin + 'ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number([...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)[1]);
};
const meanDb = (file, seconds) => {
  const args = ['-hide_banner', '-nostats', ...(seconds ? ['-t', String(seconds)] : []), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'];
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync(bin + 'ffmpeg', args, { encoding: 'utf8' }).stderr)[1]);
};
const jitter = file => {
  const r = spawnSync(bin + 'ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf',
    'tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { encoding: 'utf8' });
  const v = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map(m => Number(m[1]));
  return v.reduce((a, b) => a + b, 0) / v.length;
};
// PSNR in dB between one frame of a and one frame of b.
const framePsnr = (a, na, b, nb) => {
  const graph = `[0:v]select=eq(n\\,${na}),setpts=N/FRAME_RATE/TB[a];[1:v]select=eq(n\\,${nb}),setpts=N/FRAME_RATE/TB[b];[a][b]psnr`;
  const r = spawnSync(bin + 'ffmpeg', ['-hide_banner', '-nostats', '-i', a, '-i', b, '-filter_complex', graph, '-f', 'null', '-'], { encoding: 'utf8' });
  return Number(/average:(\S+)/.exec(r.stderr)[1]);
};

const clip = path.join(out, 'Clip.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=60', '-t', '60', '-map', '0:v', '-map', '1:a', '-map', '2:a',
  '-c:v', 'libx264', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:a:0', 'language=fra',
  '-metadata:s:a:1', 'language=eng', clip]);
const short = path.join(out, 'Short.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', short]);
// Sound that decays, so reversing it is audible, and a shaky copy of the same picture for stabilize.
const tone = path.join(out, 'Tone.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*440*t)*exp(-2*t):d=4:s=48000',
  '-t', '4', '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', tone]);
const shaky = path.join(out, 'Shaky.mp4');
ff(['-i', tone, '-vf', "crop=w=600:h=324:x='20+18*sin(2*PI*t*3)':y='18+14*sin(2*PI*t*2.3)',scale=640:360",
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', shaky]);
const inputHashes = new Map([[clip, sha(clip)], [short, sha(short)], [tone, sha(tone)], [shaky, sha(shaky)]]);

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'design-editor-media-'));
const app = await _electron.launch({ args: [root], env: { ...env, DESIGN_EDITOR_DATA: data } });
const setDialogs = (open, dir) => app.evaluate(({ dialog }, { open, dir }) => {
  dialog.showOpenDialog = async (...args) => {
    const options = args[args.length - 1];
    return { canceled: false, filePaths: options.properties.includes('openDirectory') ? [dir] : open };
  };
  dialog.showMessageBoxSync = () => 1;
}, { open, dir });

await app.firstWindow();
await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('media').click());
let m;
for (let i = 0; i < 100 && !m; i++) {
  m = app.windows().find(w => w.url().endsWith('media.html'));
  if (!m) await sleep(50);
}
assert.ok(m, 'the media window opens from File > Media Tools');
await m.waitForLoadState('domcontentloaded');
assert.equal(await m.locator('.tools button').count(), 10);
assert.equal(await m.isDisabled('#start'), true);

const status = await m.evaluate(() => window.native.media.status());
assert.equal(status.ready, true);
assert.deepEqual(status.destinations.map(d => d.id), ['discord', 'discord-nitro-basic', 'email', 'whatsapp']);

await setDialogs([clip, short, tone, shaky], folder);
const picked = await m.evaluate(() => window.native.media.pick());
const [info, shortInfo, toneInfo, shakyInfo] = picked;
assert.equal(info.container, 'mp4');
assert.deepEqual(info.tracks.map(t => t.kind), ['video', 'audio', 'audio']);
assert.ok(Math.abs(info.durationS - 60) < 0.2, `duration ${info.durationS}`);
assert.equal(info.tracks[1].language, 'fra');

await setDialogs([], folder);
const dest = await m.evaluate(() => window.native.media.pickFolder());
const enqueue = specs => m.evaluate(items => window.native.media.enqueue(items), specs.map(spec => ({ folderId: dest.id, spec })));
const queueNow = () => m.evaluate(() => window.native.media.queue());
async function settle(ids, ms = 900_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const mine = (await queueNow()).filter(j => ids.includes(j.id));
    if (mine.length === ids.length && mine.every(j => ['done', 'failed', 'cancelled'].includes(j.state))) return mine;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the queue: ${JSON.stringify((await queueNow()).map(j => [j.state, j.progress, j.error]))}`);
    await sleep(250);
  }
}
const report = (label, job) => {
  const seconds = ((job.finishedAt - job.startedAt) / 1000).toFixed(1);
  const bytes = job.outputs[0]?.bytes ?? 0;
  console.log(`${label}: ${job.state}, ${(bytes / MB).toFixed(2)} MB, ${job.attempt} attempt(s), ${seconds} s`);
};

const size = await enqueue([{ tool: 'size', inputId: info.id, targetBytes: 20 * MB, encoder: 'x264' }]);
const [sizeJob] = await settle(size);
report('compress to 20 MB', sizeJob);
assert.equal(sizeJob.state, 'done', sizeJob.error);
assert.ok(sizeJob.outputs[0].bytes <= 20 * MB, 'the output is above the target');
assert.equal(sizeJob.outputs[0].name, 'Clip (compressed).mp4');

const quality = await enqueue([{ tool: 'quality', inputId: info.id, preset: 'small' }]);
const [qualityJob] = await settle(quality);
assert.equal(qualityJob.state, 'done', qualityJob.error);
assert.equal(qualityJob.outputs[0].name, 'Clip (compressed) 2.mp4');

const clipSpec = { tool: 'clip', inputId: info.id, startS: 13, endS: 43, mode: 'copy' };
const planned = await m.evaluate(spec => window.native.media.plan(spec), clipSpec);
assert.equal(planned.ok, true);
assert.ok(planned.plan.keyframeS <= 13);
const [clipJob] = await settle(await enqueue([clipSpec]));
assert.equal(clipJob.state, 'done', clipJob.error);
const clipOut = probe(path.join(folder, clipJob.outputs[0].name));
assert.equal(clipOut.streams.filter(s => s.codec_type === 'audio').length, 2);
assert.ok(Math.abs(Number(clipOut.format.duration) - (43 - planned.plan.keyframeS)) < 0.2);

const [exactJob] = await settle(await enqueue([{ ...clipSpec, mode: 'exact' }]));
assert.equal(exactJob.state, 'done', exactJob.error);
assert.ok(Math.abs(Number(probe(path.join(folder, exactJob.outputs[0].name)).format.duration) - 30) < 0.2);

const audio = await settle(await enqueue([1, 2].map(i => ({ tool: 'audio', inputId: info.id, trackIndex: info.tracks[i].index }))));
assert.deepEqual(audio.map(j => j.outputs[0]?.name), ['Clip (audio 1 fra).m4a', 'Clip (audio 2 eng).m4a']);
for (const j of audio) {
  assert.equal(j.state, 'done', j.error);
  assert.ok(Math.abs(Number(probe(path.join(folder, j.outputs[0].name)).format.duration) - 60) < 0.2);
}

const [gifJob] = await settle(await enqueue([{ tool: 'gif', inputId: info.id, startS: 0, endS: 3, width: 480, fps: 12 }]));
assert.equal(gifJob.state, 'done', gifJob.error);
assert.equal(gifJob.outputs[0].name, 'Clip.gif');
assert.equal(probe(path.join(folder, 'Clip.gif')).streams[0].width, 480);

const plannedRemux = await m.evaluate(spec => window.native.media.plan(spec), { tool: 'convert', inputId: info.id, target: 'mkv', videoCodec: 'h264' });
assert.equal(plannedRemux.plan.mode, 'remux');
const [mkvJob] = await settle(await enqueue([{ tool: 'convert', inputId: info.id, target: 'mkv', videoCodec: 'h264' }]));
assert.equal(mkvJob.state, 'done', mkvJob.error);
const [webmJob] = await settle(await enqueue([{ tool: 'convert', inputId: shortInfo.id, target: 'webm', videoCodec: 'h264' }]));
assert.equal(webmJob.state, 'done', webmJob.error);
assert.equal(probe(path.join(folder, webmJob.outputs[0].name)).streams[0].codec_name, 'vp9');

const [mutedJob] = await settle(await enqueue([{ tool: 'convert', inputId: info.id, target: 'mp4', videoCodec: 'h264', muted: true }]));
assert.equal(mutedJob.state, 'done', mutedJob.error);
const mutedStreams = probe(path.join(folder, mutedJob.outputs[0].name)).streams;
assert.deepEqual(mutedStreams.map(s => s.codec_type), ['video'], 'the muted MP4 keeps only its video');

const [pngJob] = await settle(await enqueue([{ tool: 'frame', inputId: info.id, timeS: 1, format: 'png' }]));
assert.equal(pngJob.state, 'done', pngJob.error);
assert.equal(pngJob.outputs[0].name, 'Clip (frame).png');
assert.equal(probe(path.join(folder, pngJob.outputs[0].name)).streams[0].codec_name, 'png');
assert.equal(probe(path.join(folder, pngJob.outputs[0].name)).streams[0].width, 1280);
const [jpgJob] = await settle(await enqueue([{ tool: 'frame', inputId: shortInfo.id, timeS: 0.5, format: 'jpg' }]));
assert.equal(jpgJob.state, 'done', jpgJob.error);
assert.equal(probe(path.join(folder, jpgJob.outputs[0].name)).streams[0].codec_name, 'mjpeg');

// Phase 2 open items: the HEVC size job and the GIF fit-under job. Both must publish under their target.
const [hevcJob] = await settle(await enqueue([{ tool: 'size', inputId: info.id, targetBytes: 20 * MB, encoder: 'hw-hevc' }]));
assert.equal(hevcJob.state, 'done', hevcJob.error);
const hevcBytes = fs.statSync(path.join(folder, hevcJob.outputs[0].name)).size;
assert.ok(hevcBytes <= 20 * MB, `HEVC output ${hevcBytes} is over 20 MB`);
assert.equal(probe(path.join(folder, hevcJob.outputs[0].name)).streams[0].codec_name, 'hevc');
console.log(`hevc size: ${(hevcBytes / MB).toFixed(2)} MB, ${hevcJob.attempt} attempt(s)`);
const [gifFitJob] = await settle(await enqueue([{ tool: 'gif', inputId: info.id, startS: 0, endS: 3, width: 480, fps: 12, targetBytes: 1 * MB }]));
assert.equal(gifFitJob.state, 'done', gifFitJob.error);
const gifFitBytes = fs.statSync(path.join(folder, gifFitJob.outputs[0].name)).size;
assert.ok(gifFitBytes <= 1 * MB, `GIF output ${gifFitBytes} is over 1 MB`);
console.log(`gif fit 1 MB: ${(gifFitBytes / 1e3).toFixed(0)} kB, ${gifFitJob.attempt} attempt(s)`);

// Volume: normalize lands on -23 LUFS, and a +6 dB gain adds 6 dB of mean volume.
const [normJob] = await settle(await enqueue([{ tool: 'volume', inputId: toneInfo.id, mode: 'normalize', gainDb: 0 }]));
assert.equal(normJob.state, 'done', normJob.error);
const normLufs = lufs(path.join(folder, normJob.outputs[0].name));
assert.ok(Math.abs(normLufs + 23) <= 1, `normalized loudness is ${normLufs} LUFS`);
console.log(`volume normalize: ${normLufs.toFixed(1)} LUFS (target -23)`);
const [gainJob] = await settle(await enqueue([{ tool: 'volume', inputId: toneInfo.id, mode: 'gain', gainDb: 6 }]));
assert.equal(gainJob.state, 'done', gainJob.error);
const gainDelta = meanDb(path.join(folder, gainJob.outputs[0].name)) - meanDb(tone);
assert.ok(Math.abs(gainDelta - 6) <= 0.5, `gain moved the mean volume by ${gainDelta} dB`);
console.log(`volume +6 dB: mean moved by ${gainDelta.toFixed(2)} dB`);

// Reverse: the first output frame is the last input frame, and the sound's fade runs the other way.
const [revJob] = await settle(await enqueue([{ tool: 'reverse', inputId: toneInfo.id, sound: true }]));
assert.equal(revJob.state, 'done', revJob.error);
const revFile = path.join(folder, revJob.outputs[0].name);
const revLast = framePsnr(revFile, 0, tone, 99);
const revFirst = framePsnr(revFile, 0, tone, 0);
assert.ok(revLast > revFirst + 5, `reversed first frame: ${revLast} dB against the last frame, ${revFirst} dB against the first`);
const headDrop = meanDb(tone, 0.5) - meanDb(revFile, 0.5);
assert.ok(headDrop > 10, `the sound's start only dropped ${headDrop} dB, so the sound did not reverse`);
console.log(`reverse: frame match ${revLast.toFixed(1)} dB vs ${revFirst.toFixed(1)} dB, sound start ${headDrop.toFixed(1)} dB quieter`);
const [silentRevJob] = await settle(await enqueue([{ tool: 'reverse', inputId: toneInfo.id, sound: false }]));
assert.equal(silentRevJob.state, 'done', silentRevJob.error);
assert.deepEqual(probe(path.join(folder, silentRevJob.outputs[0].name)).streams.map(s => s.codec_type), ['video']);
await assert.rejects(enqueue([{ tool: 'reverse', inputId: info.id, sound: true }]), /up to 10 seconds/);

// Stabilize: the shaky clip keeps its size, and the stabilized copy moves less from frame to frame.
const [stabJob] = await settle(await enqueue([{ tool: 'stabilize', inputId: shakyInfo.id, level: 'recommended' }]));
assert.equal(stabJob.state, 'done', stabJob.error);
const stabFile = path.join(folder, stabJob.outputs[0].name);
assert.equal(probe(stabFile).streams[0].width, 640);
const shakyJitter = jitter(shaky);
const stabJitter = jitter(stabFile);
assert.ok(stabJitter < shakyJitter, `stabilized jitter ${stabJitter} is not below the shaky ${shakyJitter}`);
console.log(`stabilize recommended: frame-to-frame ${shakyJitter.toFixed(2)} -> ${stabJitter.toFixed(2)}`);

// The player plays through the mediain scheme, and an id that was never picked gets nothing.
const preview = await m.evaluate(async id => {
  const v = document.getElementById('clipVideo');
  v.src = `mediain://${id}/`;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('metadata failed')); });
  await new Promise(res => { v.onseeked = res; v.currentTime = 30; });
  const seeked = v.currentTime;
  const unknown = document.createElement('video');
  unknown.src = 'mediain://00000000-0000-0000-0000-000000000000/';
  await new Promise(res => { unknown.onerror = res; unknown.onloadedmetadata = res; });
  return { duration: v.duration, width: v.videoWidth, seeked, unknownError: unknown.error ? unknown.error.code : null };
}, info.id);
assert.equal(preview.duration, 60);
assert.equal(preview.width, 1280);
assert.ok(Math.abs(preview.seeked - 30) < 0.01, `seek landed at ${preview.seeked}`);
assert.notEqual(preview.unknownError, null, 'an unknown input id must not play');
console.log(`preview: ${preview.width} px, seek to ${preview.seeked.toFixed(2)} s, unknown id refused`);

await assert.rejects(enqueue([{ tool: 'size', inputId: 'not-a-file', targetBytes: 20 * MB, encoder: 'x264' }]), /changed since you picked it/);
await assert.rejects(m.evaluate(() => window.native.media.enqueue([{ folderId: 'nope', spec: { tool: 'quality', inputId: 'x', preset: 'small' } }])), /output folder/);
await assert.rejects(enqueue([{ tool: 'size', inputId: shortInfo.id, targetBytes: 20 * MB, encoder: 'x264' }]), /below this file's size/);

// A cancelled job's partial output is removed, not left in the chosen folder.
const [cancelId] = await enqueue([{ tool: 'size', inputId: info.id, targetBytes: 5 * MB, encoder: 'x264' }]);
for (let i = 0; i < 200; i++) {
  const j = (await queueNow()).find(x => x.id === cancelId);
  if (j?.state === 'running' && j.progress > 0.05) break;
  await sleep(100);
}
await m.evaluate(id => window.native.media.cancel(id), cancelId);
const [cancelled] = await settle([cancelId]);
assert.equal(cancelled.state, 'cancelled');
assert.equal(fs.readdirSync(folder).some(n => n.endsWith('.part')), false);

// The quit prompt keeps a running job when the answer is "Keep running".
const [keepId] = await enqueue([{ tool: 'size', inputId: info.id, targetBytes: 5 * MB, encoder: 'x264' }]);
await sleep(800);
const prevented = await app.evaluate(({ app }) => {
  let prevented = false;
  app.emit('before-quit', { preventDefault: () => { prevented = true; } });
  return prevented;
});
assert.equal(prevented, true, 'quit was not stopped by the running job');
await m.evaluate(() => window.native.media.cancel('all'));
await settle([keepId]);

for (const [file, hash] of inputHashes) assert.equal(sha(file), hash, `${path.basename(file)} changed`);
console.log('input hashes unchanged');

await app.close();
fs.rmSync(data, { recursive: true, force: true });
console.log('media e2e ok');
