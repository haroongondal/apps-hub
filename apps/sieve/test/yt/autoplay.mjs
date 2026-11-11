// Task 2.11: autoplay rules. The fixture autoplays on load and after each navigation; the tests count the video's own play events.
import { setTimeout as sleep } from 'node:timers/promises';
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
// Inert, so it may stay on the context: the play count, and the visibility at the page's start (a Meta-click tab is not made by `open`).
const counters = () => {
  window.__plays = 0;
  window.__first = document.visibilityState;
  document.addEventListener('play', (e) => { if (e.target === document.querySelector('#movie_player video')) window.__plays++; }, true);
};

async function open(t, path, fixture) {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  await page.addInitScript(script);
  await page.goto(ytUrl(t, path, fixture), { waitUntil: 'load' });
  return page;
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

    // Background tabs: a Meta-click opens a link in a tab behind this one, and headless Chrome reports that tab as hidden while its scripts start.
    await setYouTube(t, { autoplay: { mode: 'background', playlists: true } });
    const opener = await mk('/watch?v=sieveTest05');
    check('autoplay background: a tab that loaded in the front plays', await until(() => playing(opener)), json(await state(opener)));
    await opener.evaluate(() => { const a = document.createElement('a'); a.id = 'bg'; a.target = '_blank'; a.href = '/watch?v=sieveTest01&fixture=watch'; a.textContent = 'open'; a.style.cssText = 'position:fixed;top:80px;left:20px;z-index:99999;font-size:40px'; document.body.append(a); });
    // Playwright makes a new tab "visible" a moment after it opens, so a script that starts first may or may not see "hidden": try a few times.
    let bg;
    let started = null;
    for (let i = 0; i < 8 && started !== 'hidden'; i++) {
      await bg?.close();
      [bg] = await Promise.all([t.ctx.waitForEvent('page'), opener.click('#bg', { modifiers: ['Meta'] })]);
      bg.on('pageerror', (e) => t.errors.push(e.message));
      await bg.waitForLoadState('load');
      await until(() => bg.evaluate(() => window.__plays > 0).catch(() => false));
      started = await bg.evaluate(() => window.__first).catch(() => null);
    }
    if (started === 'hidden') {
      check('autoplay background: a tab opened behind another is paused', await until(async () => (await state(bg)).paused) && (await state(bg)).t < 0.5, json(await state(bg)));
      await bg.bringToFront();
      await sleep(1200);
      check('autoplay background: bringing it to the front does not start it', (await state(bg)).paused, json(await state(bg)));
      await bg.reload({ waitUntil: 'load' });
      check('autoplay background: a second load, in the front, plays', await until(() => playing(bg)), json(await state(bg)));
    } else console.log(`SKIP  autoplay background: the new tab reported visibilityState ${started} at its start, so it was not behind another tab`);
    await bg.close();
    await opener.close();

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
