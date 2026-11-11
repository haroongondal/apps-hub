// Task 2.11: autoplay rules. The fixture autoplays on load and after each navigation; the tests count the video's own play events.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { mergeYouTube, validateYouTube } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { SEL } from '../../src/yt/selectors.ts';
import { navigate, openYt, setYouTube, until, ytUrl } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const state = (page) => page.evaluate((s) => { const v = document.querySelector(s); return { paused: v.paused, t: +v.currentTime.toFixed(2), plays: window.__plays }; }, SEL.video);
const playing = (page, from = 0.3) => page.evaluate(([s, t]) => { const v = document.querySelector(s); return !v.paused && v.currentTime > t; }, [SEL.video, from]);
const plays = (page, n) => until(async () => (await state(page)).plays >= n);
const players = (t) => t.sw.evaluate(() => chrome.storage.session.get('ytPlayers').then((r) => r.ytPlayers ?? null));

// What YouTube does for a click or a space on the player: toggle play. Counts every play event, as the module sees them.
const script = () => {
  const video = () => document.querySelector('#movie_player video');
  document.addEventListener('click', (e) => { if (e.isTrusted && e.target.closest?.('#movie_player') && video().paused) video().play().catch(() => {}); });
  document.addEventListener('keydown', (e) => { if (e.isTrusted && e.key === ' ' && !e.target.closest?.('input, textarea') && video().paused) video().play().catch(() => {}); });
  // The link a Meta-click opens in a new background tab, and the fixture's own link handler must not turn into an in-app navigation.
  document.addEventListener('click', (e) => { if (e.metaKey) e.stopImmediatePropagation(); });
};
// Inert, so it may stay on the context: the play count.
const counters = () => {
  window.__plays = 0;
  document.addEventListener('play', (e) => { if (e.target === document.querySelector('#movie_player video')) window.__plays++; }, true);
};

async function open(t, path, fixture) {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  await page.addInitScript(script);
  await page.goto(ytUrl(t, path, fixture), { waitUntil: 'load' });
  return page;
}

const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = fileURLToPath(new URL('../../dist', import.meta.url));
const COUNT_PLAYS = `window.__plays = 0; window.__first = document.visibilityState; document.addEventListener('play', (e) => { if (e.target.matches('#movie_player video')) window.__plays++; }, true);`;

// A tab opened with `background: true` over raw DevTools is hidden for real (headless Chrome, no driver emulating visibility), and its
// first script sees `document.visibilityState === 'hidden'`: the case where "In tabs opened in the background" has to stop the video.
async function hiddenTabs(t) {
  const { check } = t;
  const profile = mkdtempSync(join(tmpdir(), 'sieve-hidden-'));
  const proc = spawn(CHROMIUM, [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    '--ignore-certificate-errors', '--host-resolver-rules=MAP www.youtube.com 127.0.0.1', '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  let spawnError;
  proc.on('error', (e) => { spawnError = e; });
  let ws;
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
    }
    if (!port) throw spawnError ?? new Error('Chrome did not write DevToolsActivePort');
    ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let n = 0;
    const waiting = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
    ws.onclose = () => { for (const fail of waiting.values()) fail({ error: { message: 'the DevTools connection closed' } }); };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => reject(new Error(`${method} got no answer in 15 s`)), 15_000);
      waiting.set(id, (d) => {
        clearTimeout(timer);
        waiting.delete(id);
        if (d.error) reject(new Error(d.error.message));
        else resolve(d.result);
      });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    const run = async (sessionId, expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`${expression.slice(0, 60)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };

    let sw;
    for (let i = 0; i < 100 && !sw; i++) {
      sw = (await send('Target.getTargets')).targetInfos.find((x) => x.type === 'service_worker' && /^chrome-extension:\/\/[a-z]+\/background\.js$/.test(x.url));
      if (!sw) await sleep(100);
    }
    const settings = mergeYouTube(validateYouTube(null), { autoplay: { mode: 'background', playlists: true, pauseOthers: false } });
    const swSession = await attach(sw.targetId);
    // The worker's `chrome.storage` may not be there yet just after the extension loads.
    for (let i = 0; i < 50; i++) {
      if (await run(swSession, 'typeof chrome.storage === "object"').catch(() => false)) break;
      await sleep(100);
    }
    await run(swSession, `chrome.storage.local.set({ youtube: ${JSON.stringify(settings)} }).then(() => true)`);

    // Created at about:blank in the background, given the play counter, then sent to the address: the tab is hidden before the page's first script.
    const open = async (path) => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', background: true });
      const session = await attach(targetId);
      await send('Page.enable', {}, session);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_PLAYS }, session);
      await send('Page.navigate', { url: `https://www.youtube.com:${t.servers.httpsPort}${path}` }, session);
      return { targetId, session, state: () => run(session, `(() => { const v = document.querySelector('#movie_player video'); return { sieve: !!document.querySelector('style[data-sieve]'), first: window.__first, now: document.visibilityState, paused: v.paused, t: +v.currentTime.toFixed(2), plays: window.__plays }; })()`).catch(() => null) };
    };
    const settle = async (tab, ms) => { await sleep(ms); return tab.state(); };

    // The tiny page calls play() again 1.5 s after the first, as YouTube does after a pause.
    const tiny = await open('/sieve-tiny?fixture=autoplay-tiny');
    let s = await settle(tiny, 3000);
    check('autoplay background: the tiny tab started hidden', s?.first === 'hidden', JSON.stringify(s));
    check('autoplay background: a tab opened behind another is paused, and so is the retry 1.5 s later', !!s && s.plays >= 2 && s.paused && s.t < 0.5, JSON.stringify(s));
    await send('Target.activateTarget', { targetId: tiny.targetId });
    s = await settle(tiny, 1200);
    check('autoplay background: bringing it to the front does not start it', !!s && s.now === 'visible' && s.paused, JSON.stringify(s));
    await run(tiny.session, 'location.reload()').catch(() => {});
    s = await settle(tiny, 2000);
    check('autoplay background: a second load, in the front, plays', !!s && s.first === 'visible' && !s.paused && s.t > 0.3, JSON.stringify(s));

    const watch = await open('/watch?v=sieveTest01&fixture=watch');
    s = await settle(watch, 3000);
    check('autoplay background: the watch fixture opened behind another tab is paused at the start', !!s && s.first === 'hidden' && s.plays >= 1 && s.paused && s.t < 0.5, JSON.stringify(s));
  } finally {
    ws?.close();
    proc.kill();
    // Chrome writes to the profile until it is gone: wait for it (killed hard after 5 s), then remove the folder.
    if ((await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) === false) {
      proc.kill('SIGKILL');
      if (!spawnError) await exited;
    }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
  }
}

export async function local(t) {
  const { check } = t;
  const pages = [];
  const mk = async (...args) => pages[pages.push(await open(t, ...args)) - 1];
  try {
    await t.ctx.addInitScript(counters);
    // Every tab.
    await setYouTube(t, { autoplay: { mode: 'always', playlists: true, pauseOthers: false } });
    let page = await mk('/watch?v=sieveTest01');
    await plays(page, 1);
    check('autoplay always: the fixture tried to play and the video is paused at once, at the start', await until(async () => (await state(page)).paused) && (await state(page)).t < 0.5, json(await state(page)));
    await sleep(1500);
    check('autoplay always: it stays paused', (await state(page)).paused && (await state(page)).t < 0.5, json(await state(page)));
    await page.locator(SEL.player).click();
    check('autoplay always: a trusted click on the player plays it, and it keeps playing for 2 s', await until(() => playing(page)), json(await state(page)));
    await sleep(2000);
    check('autoplay always: still playing 2 s later', await playing(page, 1.5), json(await state(page)));
    const p0 = (await state(page)).plays;
    await navigate(page, 'sieveTest02');
    check('autoplay always: after an in-app navigation the next video is paused again', (await plays(page, p0 + 1)) && (await until(async () => (await state(page)).paused)) && (await state(page)).t < 0.5, json(await state(page)));

    // Forged events cannot unlock a play (Review Focus 4): a click, a pointerdown and a key that the page makes up carry no trust.
    await page.evaluate((s) => {
      const p = document.querySelector('#movie_player');
      for (const type of ['pointerdown', 'click', 'mousedown']) p.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      p.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      document.querySelector(s).play().catch(() => {});
    }, SEL.video);
    await sleep(600);
    check('autoplay always: forged pointer and key events do not let a play through', (await state(page)).paused, json(await state(page)));
    await page.keyboard.press(' ');
    check('autoplay always: a trusted space with nothing focused plays it', await until(() => playing(page)), json(await state(page)));
    await page.close();

    page = await mk('/watch?v=sieveTest01&list=PLsieve&index=1');
    check('autoplay always: in a playlist it plays (playlists on)', await until(() => playing(page)), json(await state(page)));
    await navigate(page, 'sieveTest02', { list: 'PLsieve', index: 2 });
    check('autoplay always: the next playlist video plays too', await until(() => playing(page)), json(await state(page)));
    await page.close();

    await setYouTube(t, { autoplay: { playlists: false } });
    page = await mk('/watch?v=sieveTest01&list=PLsieve&index=1');
    await plays(page, 1);
    check('autoplay always: with playlists off, a playlist video is paused', await until(async () => (await state(page)).paused) && (await state(page)).t < 0.5, json(await state(page)));
    await page.close();

    // A source swap on the same video (YouTube does it between an ad and the content) is not a new video: it is not judged again.
    const swap = (p) => p.evaluate((s) => { const v = document.querySelector(s); v.pause(); v.src = v.src; v.play().catch(() => {}); }, SEL.video);
    page = await mk('/watch?v=sieveTest01&autoplay=0');
    await page.locator(SEL.player).click();
    await until(() => playing(page));
    await sleep(1200); // the click is older than the second Sieve gives a press
    await swap(page);
    check('autoplay always: emptied and play on the same video id are not judged again', await until(() => playing(page, 0)), json(await state(page)));
    await page.close();

    // An ad is judged like any play: a pre-roll nobody started is stopped, and one the owner started lets the content after it play.
    const ad = (p, on) => p.evaluate((a) => document.querySelector('#movie_player').classList.toggle('ad-showing', a), on);
    page = await mk('/watch?v=sieveTest01&autoplay=0');
    await ad(page, true);
    await page.evaluate((s) => document.querySelector(s).play().catch(() => {}), SEL.video);
    await sleep(300);
    check('autoplay always: a pre-roll ad nobody started is stopped', (await state(page)).paused && (await state(page)).t < 0.5, json(await state(page)));
    await ad(page, false);
    await swap(page);
    check('autoplay always: the content after an ad nobody started is stopped too', await until(async () => (await state(page)).paused) && (await sleep(500), (await state(page)).paused), json(await state(page)));
    await page.close();
    page = await mk('/watch?v=sieveTest01&autoplay=0');
    await ad(page, true);
    await page.locator(SEL.player).click();
    await until(() => playing(page, 0.2));
    await ad(page, false);
    await sleep(1200); // the click is older than the second Sieve gives a press, so only the owner's play of the ad lets the content through
    await swap(page);
    check('autoplay always: an ad the owner started leaves the content after it playing', await until(() => playing(page, 0)), json(await state(page)));
    await page.close();

    // The embed frame is a page of its own with its own content script.
    const host = await t.ctx.newPage();
    host.on('pageerror', (e) => t.errors.push(e.message));
    await host.addInitScript(script);
    await host.goto(`https://localhost:${t.servers.httpsPort}/yt/embed-host.html`, { waitUntil: 'load' });
    const frame = await until(() => host.frames().find((f) => new URL(f.url()).hostname === 'www.youtube-nocookie.com'));
    await sleep(1200);
    check('autoplay always: an embedded video does not start by itself', !!frame && (await frame.evaluate((s) => { const v = document.querySelector(s); return v.paused && v.currentTime < 0.5; }, SEL.video)));
    await host.close();

    // The YouTube tools switch: off means no rule at all.
    await setYouTube(t, { on: false, autoplay: { mode: 'always' } });
    page = await mk('/watch?v=sieveTest01');
    check('autoplay: with the YouTube tools off nothing is stopped', await until(() => playing(page)), json(await state(page)));
    await page.close();
    await setYouTube(t, { on: true, autoplay: { mode: 'allow' } });
    page = await mk('/watch?v=sieveTest01');
    check('autoplay allow: the video plays', await until(() => playing(page)), json(await state(page)));
    await page.close();

    // Background tabs: Playwright makes every tab it sees "visible", so these run in a Chrome of their own, driven by raw DevTools messages.
    await hiddenTabs(t);

    // Pause others.
    await setYouTube(t, { autoplay: { mode: 'allow', pauseOthers: true } });
    const a = await mk('/watch?v=sieveTest01');
    check('pause others: tab A plays', await until(() => playing(a)), json(await state(a)));
    const b = await mk('/watch?v=sieveTest02');
    check('pause others: when B plays, A pauses within 1 s', (await until(() => playing(b))) && (await until(async () => (await state(a)).paused, 1000)), `${json(await state(a))} ${json(await state(b))}`);
    check('pause others: B keeps playing (a tab does not pause itself)', (await sleep(500), await playing(b, 0.2)), json(await state(b)));
    await a.evaluate((s) => document.querySelector(s).play(), SEL.video);
    check('pause others: playing A again pauses B', (await until(() => playing(a, 0))) && (await until(async () => (await state(b)).paused, 1000)), `${json(await state(a))} ${json(await state(b))}`);
    const ids = await players(t);
    check('pause others: session storage holds the two tabs', Array.isArray(ids) && ids.length === 2 && ids.every(Number.isInteger), json(ids));

    // An embed in a host page: its frame tells the worker for the host's tab.
    const host2 = await t.ctx.newPage();
    host2.on('pageerror', (e) => t.errors.push(e.message));
    await host2.goto(`https://localhost:${t.servers.httpsPort}/yt/embed-host.html`, { waitUntil: 'load' });
    const frame2 = await until(() => host2.frames().find((f) => new URL(f.url()).hostname === 'www.youtube-nocookie.com'));
    const framePlaying = () => frame2.evaluate((s) => { const v = document.querySelector(s); return !v.paused && v.currentTime > 0.3; }, SEL.video).catch(() => false);
    check('pause others: the embed plays', !!frame2 && (await until(framePlaying)), 'the embed did not play');
    await a.bringToFront();
    await a.evaluate((s) => { const v = document.querySelector(s); v.pause(); v.play(); }, SEL.video);
    check('pause others: when A plays, the embed in another tab pauses within 1 s', await until(async () => !(await framePlaying()), 1500), json(await state(a)));
    await host2.close();

    // A forged `playing` makes up no player: storage keeps what real plays put there.
    const before = json(await players(t));
    const quiet = await mk('/watch?v=sieveTest03&autoplay=0');
    await quiet.evaluate((s) => document.querySelector(s).dispatchEvent(new Event('playing')), SEL.video);
    await sleep(500);
    check('pause others: a forged playing event writes nothing to session storage and pauses nobody', json(await players(t)) === before && (await playing(a, 0)), `${before} ${json(await players(t))}`);
    await quiet.close();
    await a.close();
    await b.close();

    // Off means off: with pause others off, B playing leaves A alone.
    await setYouTube(t, { autoplay: { pauseOthers: false } });
    const c = await mk('/watch?v=sieveTest01');
    await until(() => playing(c));
    const d = await mk('/watch?v=sieveTest02');
    await until(() => playing(d));
    await sleep(800);
    check('pause others: with it off both keep playing', (await playing(c, 0.2)) && (await playing(d, 0.2)), `${json(await state(c))} ${json(await state(d))}`);
  } finally {
    for (const p of pages) await p.close().catch(() => {});
    await setYouTube(t, { on: true, autoplay: { mode: 'allow', playlists: true, pauseOthers: false } }).catch(() => {});
  }
}

export async function live(t) {
  const { check, page } = t;
  const state = () => page.evaluate((s) => { const p = document.querySelector('#movie_player'); const v = document.querySelector(s); return { state: p.getPlayerState(), ad: p.classList.contains('ad-showing'), paused: v.paused, t: v.currentTime }; }, SEL.video).catch(() => null);
  try {
    await setYouTube(t, { autoplay: { mode: 'always', playlists: true, pauseOthers: false } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((s) => document.querySelector(s)?.readyState >= 1, SEL.video, { timeout: 30_000 }).catch(() => {});
    await sleep(3000);
    const s = await state();
    if (s?.ad) return console.log('SKIP  autoplay live: an ad was showing');
    check('live autoplay: with "In every tab" the real player is paused 3 s after load, near the start', !!s && s.paused && s.t < 1, json(s));
    await page.mouse.click(400, 300);
    check('live autoplay: a trusted click on the player plays it', await until(async () => (await state())?.paused === false, 5000), json(await state()));
  } finally {
    await setYouTube(t, { autoplay: { mode: 'allow' } }).catch(() => {});
  }
}
