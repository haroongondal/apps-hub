import { _electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
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

const clip = path.join(out, 'Clip.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=60', '-t', '60', '-map', '0:v', '-map', '1:a', '-map', '2:a',
  '-c:v', 'libx264', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:a:0', 'language=fra',
  '-metadata:s:a:1', 'language=eng', clip]);
const short = path.join(out, 'Short.mp4');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', short]);
const inputHashes = new Map([[clip, sha(clip)], [short, sha(short)]]);

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
assert.equal(await m.locator('.tools button').count(), 7);
assert.equal(await m.isDisabled('#start'), true);

const status = await m.evaluate(() => window.native.media.status());
assert.equal(status.ready, true);
assert.deepEqual(status.destinations.map(d => d.id), ['discord', 'discord-nitro-basic', 'email', 'whatsapp']);

await setDialogs([clip, short], folder);
const picked = await m.evaluate(() => window.native.media.pick());
const [info, shortInfo] = picked;
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
