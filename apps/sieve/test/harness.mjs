// Headless Chromium with dist/ in a fresh temporary profile (never the owner's); set PLAYWRIGHT_CORE and CHROMIUM_PATH if yours live elsewhere.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = fileURLToPath(new URL('../dist', import.meta.url));
const PAGES = fileURLToPath(new URL('pages', import.meta.url));
const YT_FIXTURE = readFileSync(new URL('../spike/fixtures/player-response.json', import.meta.url), 'utf8');

// `||host^` rules with no options, picked from EasyList and EasyPrivacy on 2026-11-06.
export const AD_HOST = 'pagead2.googlesyndication.com';
export const TRACKER_HOST = 'googletagmanager.com';
// EasyList `foreverconscious.com,…##.widget_media_image` and ABP anti-cv `…,foreverconscious.com,…#$#abort-on-property-read g00gletag`.
export const SITE_HOST = 'foreverconscious.com';
// EasyList `linuxtracker.org#@##adbar` keeps it out of the registered ads stylesheet, so its generic CSS comes per page.
export const UNHIDE_HOST = 'linuxtracker.org';

export const results = [];
export function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
}

const YT_HOSTS = ['www.youtube.com', 'www.youtube-nocookie.com'];

// 5 s, 440 Hz, mono, 16-bit, 8 kHz: 44 + 80,000 bytes.
const TONE = (() => {
  const rate = 8000;
  const samples = rate * 5;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return wav;
})();

// Chrome's media element asks for `bytes=0-` and seeks with ranges, so a plain 200 would break seeking.
function serveTone(req, res) {
  res.setHeader('content-type', 'audio/wav');
  res.setHeader('accept-ranges', 'bytes');
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!m || (m[1] === '' && m[2] === '')) {
    res.setHeader('content-length', TONE.length);
    return res.end(TONE);
  }
  const start = m[1] === '' ? TONE.length - Number(m[2]) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? TONE.length - 1 : Math.min(Number(m[2]), TONE.length - 1);
  if (start > end || start >= TONE.length) {
    res.statusCode = 416;
    res.setHeader('content-range', `bytes */${TONE.length}`);
    return res.end();
  }
  res.statusCode = 206;
  res.setHeader('content-range', `bytes ${start}-${end}/${TONE.length}`);
  res.setHeader('content-length', end - start + 1);
  res.end(TONE.subarray(start, end + 1));
}

export async function startServers() {
  const hits = [];
  const ports = {};
  const handler = (req, res) => {
    hits.push(req.url);
    if (YT_HOSTS.includes((req.headers.host ?? '').split(':')[0])) {
      const url = new URL(req.url, 'http://x');
      const fixture = url.searchParams.get('fixture');
      if (fixture && /^[a-z0-9-]+$/.test(fixture) && existsSync(join(PAGES, 'yt', `${fixture}.html`))) {
        res.setHeader('content-type', 'text/html');
        return res.end(readFileSync(join(PAGES, 'yt', `${fixture}.html`), 'utf8').replaceAll('%PORT%', ports.httpsPort));
      }
      const script = /^\/yt\/([a-z0-9-]+\.js)$/.exec(url.pathname);
      if (script && existsSync(join(PAGES, 'yt', script[1]))) {
        res.setHeader('content-type', 'text/javascript');
        return res.end(readFileSync(join(PAGES, 'yt', script[1])));
      }
      if (url.pathname === '/media/tone.wav') return serveTone(req, res);
    }
    if (req.url.startsWith('/watch?')) {
      res.setHeader('content-type', 'text/html');
      return res.end(readFileSync(join(PAGES, 'yt-watch.html'), 'utf8').replaceAll('%YT_FIXTURE%', YT_FIXTURE));
    }
    const file = join(PAGES, new URL(req.url, 'http://x').pathname);
    if (req.url.endsWith('.html') && file.startsWith(PAGES) && existsSync(file)) {
      res.setHeader('content-type', 'text/html');
      return res.end(readFileSync(file, 'utf8').replaceAll('%PORT%', ports.httpsPort).replaceAll('%AD_HOST%', AD_HOST).replaceAll('%TRACKER_HOST%', TRACKER_HOST).replaceAll('%SITE_HOST%', SITE_HOST));
    }
    res.setHeader('content-type', 'text/javascript');
    res.end('');
  };
  const certDir = mkdtempSync(join(tmpdir(), 'sieve-cert-'));
  let tls;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '1', '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { stdio: 'ignore' });
    tls = { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) };
  } finally {
    rmSync(certDir, { recursive: true, force: true });
  }
  const plain = http.createServer(handler);
  const secure = https.createServer(tls, handler);
  await Promise.all([plain, secure].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  ports.port = plain.address().port;
  ports.httpsPort = secure.address().port;
  return { http: plain, https: secure, ...ports, hits };
}

export async function launch({ extraArgs = [], extraHosts = [], mapHosts = true, extension = true } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'sieve-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM,
    headless: true,
    args: [
      ...(extension ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : []),
      ...(mapHosts ? ['--ignore-certificate-errors', `--host-resolver-rules=${[AD_HOST, TRACKER_HOST, SITE_HOST, UNHIDE_HOST, 'www.youtube.com', ...extraHosts].map((h) => `MAP ${h} 127.0.0.1`).join(',')}`] : []),
      ...extraArgs,
    ],
  });
  // Chrome still writes to the profile just after `close`, so it goes at exit, after Playwright's handlers (added at launch) stop it.
  process.on('exit', () => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  });
  process.once('SIGINT', () => process.exit(130));
  if (!extension) return { ctx };
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  return { ctx, sw, id: new URL(sw.url()).host };
}

// Resolves with the worker's running status ('stopped' on success), as seen when it stopped: something may start it again
// at once. Playwright's own `close` event for the worker can arrive much later, so this watches Chrome's status instead.
export async function stopWorker(ctx) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  let status = 'unknown';
  let timer;
  const stopped = new Promise((resolve) => {
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const v of versions) if (v.scriptURL.startsWith('chrome-extension://')) status = v.runningStatus;
      if (status === 'stopped') resolve(status);
    });
    timer = setTimeout(() => resolve(status), 10_000);
  });
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const result = await stopped;
  clearTimeout(timer);
  await cdp.detach();
  return result;
}

// Starts the worker after stopWorker. Playwright fires no new `serviceworker` event: its existing handle reaches the
// new worker instance (globals set before the stop are gone), so this resolves with that handle.
export async function startWorker(ctx, id) {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${id}/` });
  await cdp.detach();
  return ctx.serviceWorkers()[0] ?? ctx.waitForEvent('serviceworker', { timeout: 10_000 });
}
