import { setTimeout as sleep } from 'node:timers/promises';
import { NAV, PLAYER_API, SEL } from '../../src/yt/selectors.ts';
import { FIXTURE_IDS, navigate, openYt, until, ytCalls } from './helpers.mjs';

const state = (page) => page.evaluate(() => ({ time: document.querySelector('#movie_player video').currentTime, paused: document.querySelector('#movie_player video').paused }));

export async function local(t) {
  const { check } = t;
  const before = t.errors.length;
  const page = await openYt(t, '/watch?v=sieveTest01');
  check('the fixture watch page loads with no page errors', t.errors.length === before, t.errors.slice(before).join(' | '));
  const apiTypes = await page.evaluate((names) => Object.fromEntries(names.map((n) => [n, typeof document.querySelector('#movie_player')[n]])), PLAYER_API);
  check('#movie_player has every PLAYER_API method, and getPlayerState is a function', PLAYER_API.every((n) => apiTypes[n] === 'function'), JSON.stringify(apiTypes));
  check('SEL.rowAnchor, SEL.sizeButton, SEL.masthead and SEL.watch are on the fixture page', (await Promise.all([SEL.rowAnchor, SEL.sizeButton, SEL.masthead, SEL.watch].map((s) => page.locator(s).count()))).every((n) => n === 1));

  await sleep(1500);
  const played = await state(page);
  check('the video plays: currentTime is over 0.5 after 1.5 s', played.time > 0.5 && !played.paused, JSON.stringify(played));
  await page.evaluate(() => (document.querySelector('#movie_player video').currentTime = 3));
  await sleep(200);
  const seeked = (await state(page)).time;
  check('the video seeks: a read within 0.3 s of setting 3 is between 2.9 and 3.3', seeked >= 2.9 && seeked <= 3.3, String(seeked));
  check('the video source is a blob: URL', (await page.evaluate(() => document.querySelector('#movie_player video').currentSrc)).startsWith('blob:'));

  const wav = await page.evaluate(async () => {
    const whole = await fetch('/media/tone.wav');
    const part = await fetch('/media/tone.wav', { headers: { Range: 'bytes=0-99' } });
    return { size: (await whole.arrayBuffer()).byteLength, ranges: whole.headers.get('accept-ranges'), status: part.status, range: part.headers.get('content-range'), partSize: (await part.arrayBuffer()).byteLength };
  });
  check('/media/tone.wav is 80,044 bytes and answers a range request with 206', wav.size === 80044 && wav.ranges === 'bytes' && wav.status === 206 && wav.range === 'bytes 0-99/80044' && wav.partSize === 100, JSON.stringify(wav));

  await page.evaluate((nav) => {
    window.__finishes = 0;
    (nav.target === 'window' ? window : document).addEventListener(nav.finish, () => window.__finishes++);
    window.__order = [];
    for (const type of [nav.start, nav.finish, nav.data]) (nav.target === 'window' ? window : document).addEventListener(type, () => window.__order.push(`${type}@${location.search}`));
    window.__marker = document.querySelector('#movie_player video');
  }, NAV);
  await navigate(page, 'sieveTest02');
  await sleep(300);
  const nav = await page.evaluate(() => ({ search: location.search, finishes: window.__finishes, order: window.__order, same: document.querySelector('#movie_player video') === window.__marker, id: document.querySelector('#movie_player').getVideoData().video_id, title: document.title }));
  check('__navigate changes location.search to v=sieveTest02 and fires NAV.finish exactly once', nav.search.includes('v=sieveTest02') && nav.finishes === 1, JSON.stringify(nav));
  check('NAV.start sees the old address, NAV.finish and NAV.data the new one, in that order', nav.order.length === 3 && nav.order[0].startsWith(`${NAV.start}@`) && nav.order[0].includes('sieveTest01') && nav.order[1].includes('sieveTest02') && nav.order[2].startsWith(`${NAV.data}@`) && nav.order[2].includes('sieveTest02'), JSON.stringify(nav.order));
  check('the same video element plays the new video, and getVideoData follows', nav.same && nav.id === 'sieveTest02' && nav.title.includes('sieveTest02'), JSON.stringify(nav));
  check('the video plays again after the navigation', await until(async () => (await state(page)).time > 0.5 && !(await state(page)).paused));

  await page.evaluate(() => window.__navigate('home'));
  const home = await page.evaluate(() => ({ watchHidden: getComputedStyle(document.querySelector('ytd-watch-flexy')).display === 'none', homeShown: getComputedStyle(document.querySelector('ytd-browse')).display !== 'none', items: document.querySelectorAll('ytd-browse ytd-rich-item-renderer').length, same: document.querySelector('#movie_player video') === window.__marker }));
  check('__navigate("home") hides the watch root, shows a grid of three, and keeps the video element', home.watchHidden && home.homeShown && home.items === 3 && home.same, JSON.stringify(home));
  await navigate(page, 'sieveTest03');
  check('navigating from home shows the watch root again', await page.evaluate(() => getComputedStyle(document.querySelector('ytd-watch-flexy')).display !== 'none'));

  const sameEl = await page.evaluate(() => {
    const anchor = document.querySelector('ytd-watch-metadata');
    window.__rerenderBelow();
    const next = document.querySelector('ytd-watch-metadata');
    return { replaced: next !== anchor && !!next && anchor.isConnected === false };
  });
  check('__rerenderBelow replaces the row anchor with a fresh copy', sameEl.replaced, JSON.stringify(sameEl));

  await page.evaluate(() => document.querySelector('.ytp-size-button').click());
  const theater = await page.evaluate(() => ({ theater: document.querySelector('ytd-watch-flexy').hasAttribute('theater'), inFullBleed: !!document.querySelector('#full-bleed-container #player-container') }));
  check('the size button toggles the theater attribute and moves the player into the full-bleed container', theater.theater && theater.inFullBleed, JSON.stringify(theater));
  await page.keyboard.press('k');
  await page.mouse.click(200, 300, { button: 'right' });
  const seen = await page.evaluate(() => ({ keys: window.__keys.map((k) => k.key), ctx: window.__ctx.length }));
  check('__keys and __ctx record keydown and contextmenu events', seen.keys.includes('k') && seen.ctx === 1, JSON.stringify(seen));
  await page.evaluate(() => { const p = document.querySelector('#movie_player'); p.setPlaybackRate(1.5); p.setVolume(30); });
  const calls = await ytCalls(page);
  check('player-API calls are recorded with name and args', calls.some((c) => c.name === 'setPlaybackRate' && c.args[0] === 1.5) && (await ytCalls(page, 'setVolume')).length === 1, JSON.stringify(calls.slice(-3)));
  await page.close();

  const listed = await openYt(t, `/watch?v=${FIXTURE_IDS[1]}&list=PLsieve&index=2`);
  const pl = await listed.evaluate(() => { const p = document.querySelector('#movie_player'); return { list: p.getPlaylist(), index: p.getPlaylistIndex() }; });
  check('list=PLsieve&index=2 makes a playlist of FIXTURE_IDS at 0-based index 1', JSON.stringify(pl) === JSON.stringify({ list: FIXTURE_IDS, index: 1 }), JSON.stringify(pl));
  await listed.evaluate(() => document.querySelector('#movie_player').nextVideo());
  await sleep(200);
  const next = await listed.evaluate(() => ({ search: location.search, index: document.querySelector('#movie_player').getPlaylistIndex() }));
  check('nextVideo moves to the next playlist entry through an in-app navigation', next.search.includes(`v=${FIXTURE_IDS[2]}`) && next.search.includes('index=3') && next.index === 2, JSON.stringify(next));
  await listed.close();

  const plain = await openYt(t, '/watch?v=sieveTest01');
  const none = await plain.evaluate(() => { const p = document.querySelector('#movie_player'); return [p.getPlaylist(), p.getPlaylistIndex()]; });
  check('outside a playlist getPlaylist is null and getPlaylistIndex is -1, as on YouTube', none[0] === null && none[1] === -1, JSON.stringify(none));
  await plain.close();

  const bad = await openYt(t, '/watch?v=sieveTest01&state=unplayable');
  const dead = await bad.evaluate(() => { const p = document.querySelector('#movie_player'); return { state: p.getPlayerState(), playable: p.getVideoData().isPlayable, src: document.querySelector('#movie_player video').currentSrc }; });
  check('state=unplayable: no source, getPlayerState -1 and isPlayable false', dead.state === -1 && dead.playable === false && dead.src === '', JSON.stringify(dead));
  await bad.close();

  const none2 = await openYt(t, '/watch?v=sieveTest01&noanchor=1');
  check('noanchor=1 leaves no row anchor', (await none2.locator(SEL.rowAnchor).count()) === 0);
  await none2.close();

  const direct = await openYt(t, '/watch?v=sieveTest01&src=direct');
  check('src=direct plays /media/tone.wav itself', (await direct.evaluate(() => document.querySelector('#movie_player video').currentSrc)).endsWith('/media/tone.wav'));
  await direct.close();

  const still = await openYt(t, '/watch?v=sieveTest01&autoplay=0');
  await sleep(800);
  check('autoplay=0 leaves the video paused at 0', (await state(still)).paused && (await state(still)).time === 0);
  await still.close();

  const canvas = await openYt(t, '/watch?v=sieveTest01&canvas=1');
  const px = await until(() => canvas.evaluate(() => { const v = document.querySelector('#movie_player video'); if (!v.videoWidth || v.paused) return null; const c = document.createElement('canvas'); c.width = 1; c.height = 1; c.getContext('2d').drawImage(v, 160, 90, 1, 1, 0, 0, 1, 1); return { w: v.videoWidth, h: v.videoHeight, rgb: [...c.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)] }; }));
  check('canvas=1 plays a 320x180 stream filled with #3366cc', !!px && px.w === 320 && px.h === 180 && px.rgb.every((v, i) => Math.abs(v - [0x33, 0x66, 0xcc][i]) < 8), JSON.stringify(px));
  await canvas.close();

  const host = await t.ctx.newPage();
  host.on('pageerror', (e) => t.errors.push(e.message));
  await host.goto(`https://localhost:${t.servers.httpsPort}/yt/embed-host.html`, { waitUntil: 'load' });
  const frame = await until(() => host.frames().find((f) => new URL(f.url()).hostname === 'www.youtube-nocookie.com'));
  const emb = frame && (await until(() => frame.evaluate(() => { const p = document.querySelector('#movie_player'); return p && typeof p.getPlayerState === 'function' && document.querySelector('#movie_player video').currentTime > 0.3 && p.getVideoData().video_id; }).catch(() => false)));
  check('the embed fixture loads in an iframe on www.youtube-nocookie.com and plays sieveTest01', emb === 'sieveTest01', String(emb));
  await host.close();
}

export async function live(t) {
  const { check, page } = t;
  const found = await page.evaluate(
    ([sel, api]) => ({ sel: Object.fromEntries(Object.entries(sel).map(([k, s]) => [k, document.querySelector(s) !== null])), api: Object.fromEntries(api.map((n) => [n, typeof document.querySelector('#movie_player')?.[n] === 'function'])) }),
    [SEL, PLAYER_API],
  );
  const missingSel = Object.keys(found.sel).filter((k) => k !== 'theaterBox' && !found.sel[k]).map((k) => `SEL.${k} (${SEL[k]})`);
  const missingApi = Object.keys(found.api).filter((k) => !found.api[k]).map((k) => `PLAYER_API ${k}`);
  check('live: every SEL entry except theaterBox finds an element on the watch page', missingSel.length === 0, `missing: ${missingSel.join(', ')}`);
  check('live: every PLAYER_API name is a function on #movie_player', missingApi.length === 0, `missing: ${missingApi.join(', ')}`);
}
