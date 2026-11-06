import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GPL build (x264). It stays on this Mac: vendor/ffmpeg is gitignored and must never be shared (PRD NFR-8).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor/ffmpeg');
const BASE = 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2';
const BINARIES = {
  ffmpeg: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
  ffprobe: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6',
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function fetchVerified(name, sha256, dir) {
  const response = await fetch(`${BASE}/${name}.zip`);
  if (!response.ok) fail(`Download of ${name} failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) fail(`SHA-256 mismatch for ${name}: expected ${sha256}, got ${actual}. Nothing was installed.`);
  const zip = path.join(dir, `${name}.zip`);
  writeFileSync(zip, bytes);
  execFileSync('ditto', ['-x', '-k', zip, dir]);
  const bin = path.join(dir, name);
  chmodSync(bin, 0o755);
  return bin;
}

if (existsSync(path.join(out, 'VERSION')) && existsSync(path.join(out, 'ffmpeg')) && existsSync(path.join(out, 'ffprobe'))) {
  console.log(`FFmpeg is already set up in ${out}:\n${readFileSync(path.join(out, 'VERSION'), 'utf8')}`);
  process.exit(0);
}

mkdirSync(out, { recursive: true });
const work = mkdtempSync(path.join(out, '.download-'));
try {
  const binaries = {};
  for (const [name, sha] of Object.entries(BINARIES)) binaries[name] = await fetchVerified(name, sha, work);
  const version = execFileSync(binaries.ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' });
  const configure = version.split('\n').find(l => l.startsWith('configuration:')) ?? '';
  if (configure.includes('--enable-nonfree')) fail('This FFmpeg build has --enable-nonfree and cannot be used. Nothing was installed.');
  const probeVersion = execFileSync(binaries.ffprobe, ['-hide_banner', '-version'], { encoding: 'utf8' });
  const lines = [
    version.split('\n')[0],
    probeVersion.split('\n')[0],
    configure,
    `source: ${BASE}`,
    `sha256 ffmpeg.zip: ${BINARIES.ffmpeg}`,
    `sha256 ffprobe.zip: ${BINARIES.ffprobe}`,
  ];
  for (const name of Object.keys(BINARIES)) renameSync(binaries[name], path.join(out, name));
  writeFileSync(path.join(out, 'VERSION'), lines.join('\n') + '\n');
  console.log(readFileSync(path.join(out, 'VERSION'), 'utf8'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
