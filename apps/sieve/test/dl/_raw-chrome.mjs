// A Chrome for Testing started by child_process and driven through raw CDP (Node's global WebSocket). Playwright is not used because it rewrites
// the download location and cannot kill the browser (F10); here a seeded Preferences file sets the real Downloads folder.
// inspected 2026-11-10, Chrome for Testing 149.0.7827.55 (probe p8.mjs, rerun on that date): chrome.downloads.download({ filename: 'Sieve/Video/own.bin' })
// from the service worker saved <default_directory>/Sieve/Video/own.bin with state complete.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The harness's rule, repeated (harness.mjs does not export it and is not edited).
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = fileURLToPath(new URL('../../dist', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchRaw({ downloadsDir, profileDir } = {}) {
  const made = [];
  if (!profileDir) made.push((profileDir = mkdtempSync(join(tmpdir(), 'sieve-raw-profile-'))));
  if (!downloadsDir) made.push((downloadsDir = mkdtempSync(join(tmpdir(), 'sieve-raw-downloads-'))));
  mkdirSync(join(profileDir, 'Default'), { recursive: true });
  writeFileSync(join(profileDir, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloadsDir, prompt_for_download: false } }));
  const child = spawn(
    CHROMIUM,
    ['--headless=new', `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = new Promise((r) => child.once('exit', r));
  const wsUrl = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not print its DevTools address: ${log.slice(-300)}`)), 20000);
    child.stderr.on('data', (d) => {
      log += d;
      const m = /DevTools listening on (ws:\S+)/.exec(log);
      if (m) (clearTimeout(timer), resolve(m[1]));
    });
    child.once('exit', () => reject(new Error('Chrome exited before it was ready')));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = () => reject(new Error('DevTools connection failed')))));
  let n = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const run = async (sessionId, expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };

  let swSession;
  for (let i = 0; i < 40 && !swSession; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const sw = targetInfos.find((x) => x.type === 'service_worker' && x.url.endsWith('background.js'));
    if (sw) swSession = await attach(sw.targetId);
    else await sleep(250);
  }
  if (!swSession) throw new Error('the extension service worker did not start');
  const id = new URL((await send('Target.getTargets')).targetInfos.find((x) => x.type === 'service_worker' && x.url.endsWith('background.js')).url).host;

  const kill = async (signal = 'SIGKILL') => {
    child.kill(signal);
    await exited;
  };
  return {
    child, profileDir, downloadsDir, id, send,
    evalSw: (expression) => run(swSession, expression),
    // evaluates in the first page target whose URL starts with urlPrefix
    async evalPage(urlPrefix, expression) {
      const { targetInfos } = await send('Target.getTargets');
      const page = targetInfos.find((x) => x.type === 'page' && x.url.startsWith(urlPrefix));
      if (!page) throw new Error(`no page target starts with ${urlPrefix}`);
      return run(await attach(page.targetId), expression);
    },
    async openPage(url) {
      return (await send('Target.createTarget', { url })).targetId;
    },
    kill,
    async close() {
      await kill('SIGTERM').catch(() => {});
      try {
        ws.close();
      } catch {
        // already closed
      }
      for (const dir of made) rmSync(dir, { recursive: true, force: true });
    },
  };
}
