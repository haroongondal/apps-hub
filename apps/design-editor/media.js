import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DESTINATIONS, ffmpegArgs, ffprobeArgs, fromFfprobe, keyframeArgs, nextGifAttempt, nextRunnable, nextSizeAttempt, outputName,
  parseKeyframe, parseProgress, planAudio, planClip, planConvert, planGif, planQuality, planSize, reduce, thumbArgs, validateSpec,
} from './vendor/media-core/index.ts';

// Electron cannot run a binary inside app.asar; the packager unpacks vendor/ffmpeg beside it.
const BIN = path.join(import.meta.dirname, 'vendor/ffmpeg').replace('app.asar', 'app.asar.unpacked');
const FFMPEG = path.join(BIN, 'ffmpeg');
const FFPROBE = path.join(BIN, 'ffprobe');
const INPUT_EXTENSIONS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'ac3', 'eac3', 'mka'];
const LABELS = { size: 'compressed', quality: 'compressed', clip: 'clip', convert: 'converted' };
const STATS_PATH = () => path.join(app.getPath('userData'), 'media-stats.json');

// The renderer only ever sends ids; the paths stay here (PRD AC-11).
const inputs = new Map();   // input id -> { path, info }
const folders = new Map();  // folder id -> path
const meta = new Map();     // job id -> { input, folder, inputName, label }
const children = new Map(); // job id -> ffmpeg child
const cancelled = new Set();
let queue = [];
let pumping = null;
let mediaWin = null;
let stats = null;
let quitting = false;

export function openMediaWindow() {
  if (mediaWin) {
    mediaWin.focus();
    return;
  }
  mediaWin = new BrowserWindow({
    width: 1120, height: 780, minWidth: 900, minHeight: 600, title: 'Media tools',
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  mediaWin.webContents.on('will-navigate', e => e.preventDefault());
  mediaWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mediaWin.on('closed', () => { mediaWin = null; });
  mediaWin.loadFile('media.html');
}

export function registerMedia() {
  ipcMain.handle('media-status', () => ({ ready: existsSync(FFMPEG) && existsSync(FFPROBE), destinations: DESTINATIONS }));
  ipcMain.handle('media-pick', async () => {
    const r = await showOpen({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video and audio', extensions: INPUT_EXTENSIONS }] });
    if (r.canceled) return [];
    const picked = [];
    for (const file of r.filePaths) {
      const json = JSON.parse(await execText(FFPROBE, ffprobeArgs(file), file));
      const info = fromFfprobe(json, randomUUID(), path.basename(file));
      inputs.set(info.id, { path: file, info });
      picked.push(info);
    }
    return picked;
  });
  ipcMain.handle('media-pick-folder', async () => {
    const r = await showOpen({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const id = randomUUID();
    folders.set(id, r.filePaths[0]);
    return { id, name: path.basename(r.filePaths[0]) };
  });
  ipcMain.handle('media-plan', (_, spec) => planFor(spec));
  ipcMain.handle('media-enqueue', (_, items) => enqueue(items));
  ipcMain.handle('media-cancel', (_, id) => (id === 'all' ? cancelAll() : cancelJob(String(id))));
  ipcMain.handle('media-keyframe', async (_, { inputId, timeS }) => keyframeAt(requireInput(inputId).path, timeS));
  ipcMain.handle('media-thumbs', async (_, { inputId, timesS }) => {
    const input = requireInput(inputId);
    const frames = [];
    for (const t of timesS.slice(0, 20)) {
      const jpeg = await execBuffer(FFMPEG, thumbArgs(input.path, t), input.path);
      frames.push(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    }
    return frames;
  });
  ipcMain.handle('media-queue', () => queue);
  ipcMain.handle('media-reveal', (_, jobId) => shell.showItemInFolder(outputOf(jobId)));
  ipcMain.handle('media-open', (_, jobId) => shell.openPath(outputOf(jobId)));
  ipcMain.on('media-open-window', () => openMediaWindow());

  app.on('before-quit', e => {
    if (quitting || !queue.some(j => j.state === 'queued' || j.state === 'running')) return;
    e.preventDefault();
    const choice = showMessageSync({
      type: 'warning', message: 'A media job is running. Quit and stop it?', buttons: ['Quit', 'Keep running'], defaultId: 1, cancelId: 1,
    });
    if (choice !== 0) return;
    quitting = true;
    cancelAll();
    Promise.resolve(pumping).finally(() => app.quit());
  });
}

async function planFor(spec) {
  const input = inputs.get(spec?.inputId);
  if (!input) return { ok: false, reason: 'invalid', detail: 'The file changed since you picked it. Pick it again.' };
  const errors = validateSpec(spec, input.info, 'mac');
  if (errors.length) return { ok: false, reason: 'invalid', detail: errors.join(' ') };
  switch (spec.tool) {
    case 'size': return planSize(input.info, spec.targetBytes, spec.encoder, { correction: correctionFor(spec.encoder), maxFps: 30 });
    case 'quality': return planQuality(input.info, spec.preset);
    case 'clip': return planClip(input.info, spec.startS, spec.endS, await keyframeAt(input.path, spec.startS), spec.mode);
    case 'audio': return planAudio(input.info.tracks.find(t => t.index === spec.trackIndex));
    case 'gif': return planGif(input.info, spec);
    case 'convert': return planConvert(input.info, spec.target, { videoCodec: spec.videoCodec });
    default: return { ok: false, reason: 'invalid', detail: "This job type isn't supported yet." };
  }
}

async function enqueue(items) {
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new Error('Pick a file and a tool first.');
  const planned = [];
  for (const item of items) {
    const folder = folders.get(item?.folderId);
    if (!folder) throw new Error('Pick an output folder first.');
    const plan = await planFor(item.spec);
    if (!plan.ok) throw new Error(refusalText(plan));
    planned.push({ input: inputs.get(item.spec.inputId), plan: plan.plan, folder });
  }
  const jobs = planned.map(({ input, plan, folder }) => {
    const job = { id: randomUUID(), inputId: input.info.id, inputName: input.info.name, plan, state: 'queued', progress: 0, attempt: 1, outputs: [] };
    meta.set(job.id, { input: input.path, folder, inputName: input.info.name, label: labelFor(plan, input.info) });
    return job;
  });
  dispatch({ type: 'enqueue', jobs });
  if (!pumping) pumping = pump().finally(() => { pumping = null; });
  return jobs.map(j => j.id);
}

async function pump() {
  const blocker = powerSaveBlocker.start('prevent-app-suspension');
  try {
    for (let job = nextRunnable(queue); job; job = nextRunnable(queue)) await runJob(job);
  } finally {
    powerSaveBlocker.stop(blocker);
  }
}

async function runJob(job) {
  const m = meta.get(job.id);
  const input = inputs.get(job.inputId);
  dispatch({ type: 'start', id: job.id, at: Date.now() });
  const tmp = path.join(app.getPath('temp'), 'design-editor-media', job.id);
  try {
    await fs.mkdir(tmp, { recursive: true });
    let plan = job.plan;
    for (let attempt = 1; ; attempt++) {
      const out = path.join(tmp, `attempt-${attempt}.${extOf(plan)}`);
      await encode(job.id, plan, input, out, tmp);
      const bytes = (await fs.stat(out)).size;
      if (plan.tool === 'size' && plan.attempt === 1) await recordRatio(plan, bytes);
      const next = checkOutput(plan, bytes);
      if (!next.ok) throw new Error(refusalText(next));
      if (next.plan === plan) {
        const output = await publish(job, out, m);
        dispatch({ type: 'done', id: job.id, outputs: [output], at: Date.now() });
        return;
      }
      plan = next.plan;
      dispatch({ type: 'retry', id: job.id, plan });
    }
  } catch (err) {
    if (!cancelled.has(job.id)) dispatch({ type: 'fail', id: job.id, error: err.message, at: Date.now() });
  } finally {
    cancelled.delete(job.id);
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function checkOutput(plan, bytes) {
  if (plan.tool === 'size') return nextSizeAttempt(plan, bytes);
  if (plan.tool === 'gif') return nextGifAttempt(plan, bytes);
  return { ok: true, plan };
}

async function encode(jobId, plan, input, out, tmp) {
  if (plan.tool === 'size' && plan.encoder === 'x264') {
    const passlog = path.join(tmp, 'x264');
    await runFfmpeg(jobId, ffmpegArgs(plan, input.path, out, { n: 1, log: passlog }), input.info.durationS, [0, 0.5]);
    await runFfmpeg(jobId, ffmpegArgs(plan, input.path, out, { n: 2, log: passlog }), input.info.durationS, [0.5, 1]);
  } else {
    await runFfmpeg(jobId, ffmpegArgs(plan, input.path, out), input.info.durationS, [0, 1]);
  }
}

function runFfmpeg(jobId, args, durationS, [from, to]) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    children.set(jobId, child);
    child.stdin.on('error', () => {});
    let pending = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      const { outTimeUs } = parseProgress(lines.join('\n'));
      if (outTimeUs !== undefined && durationS > 0) {
        dispatch({ type: 'progress', id: jobId, fraction: from + (to - from) * Math.min(1, outTimeUs / 1e6 / durationS) });
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.on('error', reject);
    child.on('close', code => {
      children.delete(jobId);
      if (cancelled.has(jobId)) reject(new Error('Cancelled'));
      else if (code === 0) resolve();
      else reject(new Error(`FFmpeg couldn't finish this file: ${stderr.trim() || `exit ${code}`} ARGS ${args.join(' ')}`));
    });
  });
}

// .part: a half-copied file never takes the real name, even when the copy crosses volumes.
async function publish(job, out, m) {
  const name = outputName(m.inputName, m.label, extOf(job.plan), n => existsSync(path.join(m.folder, n)) || path.join(m.folder, n) === m.input);
  const dest = path.join(m.folder, name);
  if (path.dirname(path.resolve(dest)) !== path.resolve(m.folder)) throw new Error('Invalid output name');
  try {
    await fs.rename(out, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    try {
      await fs.copyFile(out, `${dest}.part`);
      await fs.rename(`${dest}.part`, dest);
    } catch (copyErr) {
      await fs.rm(`${dest}.part`, { force: true });
      throw copyErr;
    }
  }
  return { name, ref: dest, bytes: (await fs.stat(dest)).size };
}

function cancelJob(jobId) {
  const job = queue.find(j => j.id === jobId);
  if (!job || (job.state !== 'queued' && job.state !== 'running')) return;
  cancelled.add(jobId);
  dispatch({ type: 'cancel', id: jobId });
  const child = children.get(jobId);
  if (child) stopChild(child);
}

function cancelAll() {
  for (const j of queue) if (j.state === 'queued' || j.state === 'running') cancelled.add(j.id);
  dispatch({ type: 'cancel', id: 'all' });
  for (const child of children.values()) stopChild(child);
}

function stopChild(child) {
  child.stdin.write('q');
  const killer = setTimeout(() => child.kill('SIGKILL'), 3000);
  child.once('close', () => clearTimeout(killer));
}

function dispatch(event) {
  queue = reduce(queue, event);
  mediaWin?.webContents.send('media-event', { type: 'queue', jobs: queue });
}

function outputOf(jobId) {
  const ref = queue.find(j => j.id === jobId)?.outputs[0]?.ref;
  if (!ref) throw new Error('This job has no file yet.');
  return ref;
}

function requireInput(inputId) {
  const input = inputs.get(inputId);
  if (!input) throw new Error('The file changed since you picked it. Pick it again.');
  return input;
}

async function keyframeAt(file, timeS) {
  return parseKeyframe(await execText(FFPROBE, keyframeArgs(file, timeS), file), timeS);
}

function labelFor(plan, info) {
  if (plan.tool !== 'audio') return LABELS[plan.tool] ?? '';
  const audio = info.tracks.filter(t => t.kind === 'audio');
  const n = audio.findIndex(t => t.index === plan.trackIndex);
  const lang = audio[n]?.language ?? '';
  const tag = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : '';
  return ['audio', n + 1, tag].filter(Boolean).join(' ');
}

function extOf(plan) {
  return { size: 'mp4', quality: 'mp4', clip: plan.ext, audio: plan.ext, gif: 'gif', convert: plan.ext }[plan.tool];
}

function refusalText(r) {
  if (r.reason === 'too-long') return `This video can hold about ${Math.floor(r.maxDurationS / 60)} minutes at the lowest quality.`;
  if (r.reason === 'gave-up') return "Couldn't fit under the size after three tries.";
  if (r.reason === 'no-video') return 'This file has no video track.';
  return r.detail ?? 'This job could not be planned.';
}

function loadStats() {
  if (!stats) {
    try {
      stats = JSON.parse(readFileSync(STATS_PATH(), 'utf8'));
    } catch {
      stats = {};
    }
  }
  return stats;
}

async function recordRatio(plan, actualBytes) {
  const s = loadStats();
  const nonVideo = plan.plannedBytes - plan.plannedVideoBytes;
  const ratio = (actualBytes - nonVideo) / plan.plannedVideoBytes;
  if (!(ratio > 0)) return;
  s[plan.encoder] = [...(s[plan.encoder] ?? []), ratio].slice(-5);
  await fs.writeFile(STATS_PATH(), JSON.stringify(s));
}

function correctionFor(encoder) {
  const list = [...(loadStats()[encoder] ?? [])].sort((a, b) => a - b);
  if (!list.length) return 1;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

async function showOpen(options) {
  const win = BrowserWindow.getFocusedWindow();
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

function showMessageSync(options) {
  const win = BrowserWindow.getFocusedWindow();
  return win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options);
}

function execText(file, args, label) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Couldn't read ${path.basename(label)}: ${stderr.trim().split('\n').pop() || err.message}`));
      else resolve(stdout);
    });
  });
}

function execBuffer(file, args, label) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err) reject(new Error(`Couldn't read a frame of ${path.basename(label)}.`));
      else resolve(stdout);
    });
  });
}
