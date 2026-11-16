// Task 2.7: quality, H.264 and 30 fps. The fixture records the player calls in window.__ytCalls; the codec checks run in the page's own world.
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate, openYt, sendToTab, setYouTube, until, ytCalls } from './helpers.mjs';

const SET = 'setPlaybackQualityRange';
const json = (v) => JSON.stringify(v);
// A public playlist and its first video (test/yt facts, inspected 2026-11-10).
const PLAYLIST = 'PL7_R_MUrr1gx09YiXgrxvCKknU7Z1raax';
const PLAYLIST_FIRST = 'rAgR2rIzCkc';
const quality = (page) => ytCalls(page, SET).then((calls) => calls.map((c) => c.args[0]));
const settled = async (page, want, count = 1) => until(async () => (await quality(page)).filter((q) => q === want).length >= count);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { quality: { videos: 'hd720' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    check('quality: with videos hd720 the player gets (hd720, hd720)', await settled(page, 'hd720'), json(await ytCalls(page, SET)));
    check('quality: the call is a range with the same value twice, and setPlaybackQuality is never used', json((await ytCalls(page, SET))[0].args) === '["hd720","hd720"]' && (await ytCalls(page, 'setPlaybackQuality')).length === 0);

    await page.evaluate(() => { window.__states = []; document.addEventListener('sieve-yt-state', (e) => window.__states.push(e.detail)); });
    await navigate(page, 'sieveTest02');
    check('quality: a new video gets the quality again', await settled(page, 'hd720', 2), json(await quality(page)));
    const state = await until(() => page.evaluate(() => window.__states.findLast((s) => s.qualities?.length)));
    check('quality: the main world sends the offered qualities (known labels, no auto) and the current one', json(state?.qualities) === '["hd2160","hd1440","hd1080","hd720","large","medium","small","tiny"]' && state?.quality === 'hd720', json(state));

    const before = (await quality(page)).length;
    await setYouTube(t, { speed: { default: 1.5 } });
    await sleep(500);
    check('quality: a change to another setting does not set the quality again', (await quality(page)).length === before, json(await quality(page)));
    await setYouTube(t, { quality: { videos: 'hd1080' } });
    check('quality: changing the quality setting applies it to the video that is playing', await settled(page, 'hd1080'), json(await quality(page)));
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-large' });
    check('quality: the command quality-large sets 480p', await settled(page, 'large'), json(await quality(page)));
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-hd2880' });
    check('quality: a command above what is offered picks the highest offered (hd2160)', await settled(page, 'hd2160'), json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'hd720', playlists: 'large' } });
    page = await openYt(t, '/watch?v=sieveTest01&list=PLsieve&index=1');
    check('quality: a playlist page gets the playlists quality (large), not the videos one', (await settled(page, 'large')) && !(await quality(page)).includes('hd720'), json(await quality(page)));
    await page.close();
    // latelist: the player names the list only 2 s after loadstart, as YouTube does on a hard load (see quality-main.ts).
    page = await openYt(t, '/watch?v=sieveTest01&list=PLsieve&index=1&latelist=1');
    check('quality: a hard-loaded playlist page gets the playlists quality (large) while the player has not named the list yet', (await settled(page, 'large')) && !(await quality(page)).includes('hd720'), json(await quality(page)));
    await page.close();
    page = await openYt(t, '/watch?v=sieveTest01&latelist=1');
    await settled(page, 'hd720');
    await navigate(page, 'sieveTest02', { list: 'PLsieve' });
    check('quality: an in-app move into a playlist gets the playlists quality (large) while the player has not named the list yet', await settled(page, 'large'), json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'auto', playlists: 'auto' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await sleep(800);
    check('quality: auto on a new video makes no call', (await quality(page)).length === 0, json(await quality(page)));
    await page.close();

    await setYouTube(t, { on: false, quality: { videos: 'hd720' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await sleep(800);
    check('quality: with YouTube tools off the player is left alone', (await quality(page)).length === 0, json(await quality(page)));
    await page.close();
    await setYouTube(t, { on: true });

    await setYouTube(t, { quality: { videos: 'hd720', videosFull: 'hd1080' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'fullscreen');
    await settled(page, 'hd720');
    await page.getByRole('button', { name: 'Full screen' }).click();
    check('quality: entering full screen sets videosFull (hd1080)', await settled(page, 'hd1080'), json(await quality(page)));
    await page.evaluate(() => document.exitFullscreen());
    check('quality: leaving full screen sets the quality outside it again (hd720)', await settled(page, 'hd720', 2), json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'large', videosFull: 'same' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'fullscreen');
    await settled(page, 'large');
    const calls = (await quality(page)).length;
    await page.getByRole('button', { name: 'Full screen' }).click();
    await sleep(600);
    check('quality: with "Same as outside full screen" entering full screen makes no call', (await quality(page)).length === calls, json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'auto', videosFull: 'hd1080' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'fullscreen');
    await sleep(400);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await settled(page, 'hd1080');
    await page.evaluate(() => document.exitFullscreen());
    check('quality: leaving full screen to auto sets auto, so a full-screen choice is undone', await until(async () => (await quality(page)).at(-1) === 'auto'), json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'auto', videosFull: 'same', embeds: 'medium' } });
    const host = await t.ctx.newPage();
    host.on('pageerror', (e) => t.errors.push(e.message));
    await host.goto(`https://localhost:${t.servers.httpsPort}/yt/embed-host.html`, { waitUntil: 'load' });
    const frame = await until(() => host.frames().find((f) => new URL(f.url()).hostname === 'www.youtube-nocookie.com'));
    const embedded = frame && (await until(() => frame.evaluate(() => window.__ytCalls.filter((c) => c.name === 'setPlaybackQualityRange').map((c) => c.args[0])).then((q) => q.includes('medium') && q).catch(() => null)));
    check('quality: the embedded player gets the embeds quality (medium)', !!embedded, json(embedded));
    await host.close();

    await codecs(t);
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

const ask = (page, js) => page.evaluate(js);
const TYPE = (type) => `MediaSource.isTypeSupported(${json(type)})`;
const INFO = (contentType, framerate = 25) => `navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: ${json(contentType)}, width: 1920, height: 1080, bitrate: 1000000, framerate: ${framerate} } }).then((r) => r.supported)`;
const VP9 = 'video/webm; codecs="vp9"';
const AVC = 'video/mp4; codecs="avc1.4d401f"';
const OPUS = 'audio/webm; codecs="opus"';
const VP09_INFO = 'video/webm; codecs="vp09.00.51.08.01.01.01.01.00"';

async function codecs(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { quality: { h264: false, max30fps: false } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings ?? null));
    const native = await ask(page, `[${TYPE(VP9)}, ${TYPE(AVC)}, ${TYPE(OPUS)}]`);
    const nativeInfo = await ask(page, `Promise.all([${INFO(VP09_INFO)}, ${INFO(AVC)}])`);
    const keys = await ask(page, `navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: ${json(AVC)}, width: 1920, height: 1080, bitrate: 1000000, framerate: 25 } }).then((r) => Object.keys(r).sort())`);
    check('codecs: with both options off nothing is refused (this Chrome supports VP9, H.264 and Opus in MSE)', json(native) === '[true,true,true]' && json(nativeInfo) === '[true,true]', json({ native, nativeInfo }));
    await page.close();

    await setYouTube(t, { quality: { h264: true } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings?.quality.h264));
    const got = await ask(page, `[${TYPE(VP9)}, ${TYPE(AVC)}, ${TYPE(OPUS)}, ${TYPE('video/mp4; codecs=av01.0.05M.08')}, ${TYPE('video/mp4; codecs="avc1.4d401f"; framerate=60')}]`);
    check('codecs: with H.264 on, VP9 and AV1 are refused, H.264 and Opus are not', json(got) === '[false,true,true,false,true]', json(got));
    const meta = await ask(page, `({ name: MediaSource.isTypeSupported.name, length: MediaSource.isTypeSupported.length, info: MediaCapabilities.prototype.decodingInfo.name, infoLength: MediaCapabilities.prototype.decodingInfo.length, proto: 'prototype' in MediaSource.isTypeSupported })`);
    check('codecs: the wrappers keep the native names and lengths, and are not constructors', json(meta) === '{"name":"isTypeSupported","length":1,"info":"decodingInfo","infoLength":1,"proto":false}', json(meta));
    const info = await ask(page, `Promise.all([${INFO(VP09_INFO)}, ${INFO(AVC)}, navigator.mediaCapabilities.decodingInfo({ type: 'media-source', audio: { contentType: ${json(OPUS)} } }).then((r) => r.supported)])`);
    check('codecs: with H.264 on, decodingInfo refuses VP9, and answers H.264 and audio as the browser does', json(info) === '[false,true,true]', json(info));
    const refused = await ask(page, `navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: ${json(VP09_INFO)}, width: 1920, height: 1080, bitrate: 1000000, framerate: 25 } }).then((r) => Object.keys(r).sort())`);
    check('codecs: a refused decodingInfo result has the same keys as an answered one', json(refused) === json(keys), json({ refused, keys }));
    const bad = await ask(page, `(async () => { const r = []; try { MediaSource.isTypeSupported(); r.push('returned'); } catch (e) { r.push(e.name); } r.push(await navigator.mediaCapabilities.decodingInfo({}).then(() => 'resolved', (e) => e.name)); return r; })()`);
    check('codecs: bad input still behaves as the native does (no argument throws, an empty configuration rejects)', json(bad) === '["TypeError","TypeError"]', json(bad));
    await page.close();

    await setYouTube(t, { quality: { h264: false, max30fps: true } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings?.quality.max30fps));
    const fps = await ask(page, `[${TYPE('video/mp4; codecs="avc1.4d401f"; framerate=60')}, ${TYPE('video/mp4; codecs="avc1.4d401f"; framerate=30')}, ${TYPE(VP9)}]`);
    const fpsInfo = await ask(page, `Promise.all([${INFO(AVC, 60)}, ${INFO(AVC, 30)}, ${INFO(VP09_INFO, 25)}])`);
    check('codecs: with 30 fps on, a type or configuration above 30 fps answers false, 30 and below as the browser does', json(fps) === '[false,true,true]' && json(fpsInfo) === '[false,true,true]', json({ fps, fpsInfo }));
    await page.close();

    await setYouTube(t, { on: false, quality: { h264: true, max30fps: true } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings?.on === false));
    const off = await ask(page, `[${TYPE(VP9)}, ${TYPE('video/mp4; codecs="avc1.4d401f"; framerate=60')}]`);
    check('codecs: with YouTube tools off nothing is refused, whatever the options', json(off) === '[true,true]', json(off));
    await page.close();
  } finally {
    await page?.close().catch(() => {});
  }
}

// Plan Step 4: with videos hd720 the player reports hd720 within 10 s, and with H.264 on the playing codec is avc1. Both would pass by
// accident at hd720 on a headless run (YouTube picks 720p there), so the quality check uses large (480p) first, then hd720.
export async function live(t) {
  const { check, page } = t;
  const state = () => page.evaluate(() => { const p = document.querySelector('#movie_player'); return { quality: p.getPlaybackQuality(), preferred: p.getPreferredQuality?.(), codecs: p.getStatsForNerds?.().codecs ?? null, id: p.getVideoData().video_id, list: p.getVideoData().list ?? null, playerState: p.getPlayerState(), sameDocument: window.__sieveQualityMark === true }; }).catch(() => null);
  const ready = () => page.waitForFunction(() => typeof document.querySelector('#movie_player')?.getStatsForNerds === 'function' && document.querySelector('#movie_player video')?.currentTime > 1, null, { timeout: 30_000 }).catch(() => {});
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  try {
    await setYouTube(t, { quality: { videos: 'large' } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    const gate = await gated();
    if (gate) return console.log(`SKIP  quality live: ${gate}`);
    check('live quality: with videos set to 480p getPlaybackQuality is large within 10 s', await until(async () => (await state())?.quality === 'large', 10_000), json(await state()));
    await setYouTube(t, { quality: { videos: 'hd720' } });
    check('live quality: changing the setting to 720p applies it to the playing video', await until(async () => (await state())?.quality === 'hd720', 10_000), json(await state()));
    // A Mix is a playlist page, so the playlists quality is large as well: the check is that every new video gets its own call.
    await setYouTube(t, { quality: { videos: 'large', playlists: 'large' } });
    await until(async () => (await state())?.quality === 'large', 10_000);
    // inspected 2026-11-17, signed out, Chrome for Testing 149.0.7827.55: the related column fills to 20 videos (4 first), each with a thumbnail and a
    // title /watch link, all visible; 12 to 18 were Mixes (`&list=RD…`), and on 1 load of 8 all 20 were, so the plain video this check wanted was not
    // there (live run 2's failure). It takes a plain video when there is one, else a Mix. 2026-11-11: the new video sat buffering (state 3, `unknown`)
    // for 16 s before it played, so the quality wait starts once it plays (state 1).
    const related = 'ytd-watch-next-secondary-results-renderer a[href^="/watch"]';
    const plain = page.locator(`${related}:not([href*="list="])`);
    const link = (await until(async () => (await plain.count()) > 0, 10_000)) ? plain.first() : page.locator(related).first();
    const href = await link.getAttribute('href', { timeout: 5000 }).catch(() => null);
    if (!href) console.log('SKIP  live quality in-app: the related column showed no /watch link in 10 s');
    else {
      await page.evaluate(() => { window.__sieveQualityMark = true; });
      await link.click({ timeout: 10_000 });
      const moved = await until(async () => { const s = await state(); return s !== null && s.sameDocument && s.id !== t.videoId; }, 15_000);
      check(`live quality: clicking a related ${href.includes('list=') ? 'Mix (no plain video was offered)' : 'video'} moves in-app to a new video`, moved, json({ href, state: await state() }));
      const playing = moved && (await until(async () => (await state())?.playerState === 1, 30_000));
      if (moved && !playing) console.log(`INCONCLUSIVE  live quality in-app: the new video did not start playing in 30 s, so its quality cannot be read  ${json(await state())}`);
      if (playing) check('live quality: after an in-app navigation the new video is on large too', await until(async () => { const s = await state(); return s?.quality === 'large' && s.preferred === 'large'; }, 10_000), json(await state()));
    }

    // inspected 2026-11-17 (see quality-main.ts): on a hard-loaded playlist page the player names the list about 2 s after the video's loadstart.
    await setYouTube(t, { quality: { videos: 'hd720', playlists: 'large' } });
    await page.goto(`https://www.youtube.com/watch?v=${PLAYLIST_FIRST}&list=${PLAYLIST}`, { waitUntil: 'domcontentloaded' });
    await ready();
    const listGate = await gated();
    if (listGate) console.log(`SKIP  live quality playlist: ${listGate}`);
    else check('live quality: a hard-loaded playlist page gets the playlists quality (480p), not the videos one (720p)', await until(async () => { const s = await state(); return s?.quality === 'large' && s.preferred === 'large'; }, 10_000), json(await state()));

    await setYouTube(t, { quality: { videos: 'hd720', h264: true } });
    await page.goto(`https://www.youtube.com/watch?v=${t.videoId}`, { waitUntil: 'domcontentloaded' });
    await ready();
    const h264 = await until(async () => /avc1/.test((await state())?.codecs ?? ''), 15_000);
    check('live codecs: with H.264 on the playing codec (getStatsForNerds) contains avc1', h264, json(await state()));
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube')).catch(() => {});
  }
}
