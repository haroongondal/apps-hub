// `test:e2e -- --live`: real youtube.com, signed out, fresh profiles. A bot-check page is what this address got, not a Sieve failure.
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results } from './harness.mjs';
import { ytModules } from './yt/helpers.mjs';

const VIDEOS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0'];
const SECONDS = 30;
const ARGS = ['--autoplay-policy=no-user-gesture-required'];
// A video that stalled with Sieve (kJQP7kiw5Fk) still got past 5 s: it has to keep up with the extension-free control instead.
const MIN_RATIO = 0.6;
const MIN_CONTROL_S = 5;

// The window opens at domcontentloaded, so it also holds the wait for the first frame, and that wait swung from 0 to 20 s
// without Sieve and with it (30 live runs, 2026-11-17); once a video had started it never stalled in either browser.
// So the check measures playback from the video's own first frame (`sieve.content`: window second and video time of the
// first and last frame sampled without an ad) and reports when each browser started. control.playedTo, the furthest the
// control got (an ad's clock counts), only shows that YouTube served this address a video.
export function judgePlayback(control, sieve) {
  if (!(control.playedTo > MIN_CONTROL_S)) return { verdict: 'inconclusive', ratio: null, text: `the control only reached ${control.playedTo} s, so playback cannot be compared` };
  const c = sieve.content;
  const span = c ? c.lastAt - c.at : 0;
  const starts = control.content ? `the control's video started at ${control.content.at} s` : 'the control showed only an ad';
  if (!c || span < MIN_CONTROL_S) return { verdict: 'fail', ratio: null, text: `with Sieve the video ${c ? `only started at ${c.at} s` : 'never started'} in the ${SECONDS} s window, ${starts}` };
  const ratio = (c.to - c.from) / span;
  return { verdict: ratio >= MIN_RATIO ? 'pass' : 'fail', ratio, text: `with Sieve it started at ${c.at} s and played ${(c.to - c.from).toFixed(1)} s of video in the next ${span.toFixed(1)} s, ratio ${ratio.toFixed(2)} (needs ${MIN_RATIO}); ${starts}` };
}

// Exit status: 1 when a check failed, 2 when no video gave evidence (every one skipped or inconclusive), else 0.
export function exitCode({ failed, videos, skipped, inconclusive }) {
  if (failed) return 1;
  return videos - skipped - inconclusive > 0 ? 0 : 2;
}

if (process.argv.includes('--self-check')) {
  const assert = (await import('node:assert/strict')).default;
  const played = (at, from, lastAt, to) => ({ endedAt: Math.round(to), content: { at, from, lastAt, to } }); // endedAt: what the window-end measure saw
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 30, 29.5)).verdict, 'pass');
  assert.equal(judgePlayback({ playedTo: 29 }, played(17, 0.6, 29.5, 13.1)).verdict, 'pass', 'run 2: a first frame at 17 s, then steady playback (was 13/29 = 0.45)');
  assert.equal(judgePlayback({ playedTo: 29 }, played(20.6, 0.9, 30, 10.2)).verdict, 'pass', 'a first frame at 20.6 s (seen 2026-11-17), then steady playback');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 30, 18.3)).verdict, 'pass', '17.8/29 = 0.61');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 30, 17.3)).verdict, 'fail', '16.8/29 = 0.58');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 30, 6)).verdict, 'fail', 'a stall after the first frame fails');
  assert.equal(judgePlayback({ playedTo: 10 }, played(1, 0, 11, 6)).verdict, 'pass', 'a ratio of exactly 0.6 passes');
  assert.equal(judgePlayback({ playedTo: 28 }, { content: null }).verdict, 'fail', 'a video that never started with Sieve fails');
  assert.equal(judgePlayback({ playedTo: 28 }, played(26, 0.5, 30, 4.5)).verdict, 'fail', 'a first frame under 5 s before the end shows no playback: a failure');
  assert.equal(judgePlayback({ playedTo: 17, content: null }, played(5.5, 0.4, 30, 24.9)).verdict, 'pass', 'a control that showed only an ad still lets the check run');
  assert.equal(judgePlayback({ playedTo: 4 }, played(1, 0.5, 30, 29.5)).verdict, 'inconclusive', 'a control that did not play cannot be compared');
  assert.equal(judgePlayback({ playedTo: 0 }, { content: null }).verdict, 'inconclusive');
  assert.equal(judgePlayback({ playedTo: 5 }, played(1, 0.5, 30, 29.5)).verdict, 'inconclusive', 'a control of exactly 5 s cannot be compared');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 3, inconclusive: 0 }), 2, 'all skipped is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 2 }), 2, 'skipped plus inconclusive is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 1 }), 0);
  assert.equal(exitCode({ failed: 1, videos: 3, skipped: 3, inconclusive: 0 }), 1, 'a failure wins');
  console.log('self-check ok');
  process.exit(0);
}

async function watch(ctx, id) {
  const page = await ctx.newPage();
  const row = { id, seconds: 0, adShowing: false, botCheck: false, consent: false, playedTo: 0, endedAt: 0, content: null };
  try {
    await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const start = Date.now();
    while (Date.now() - start < SECONDS * 1000) {
      const s = await page
        .evaluate(() => ({
          ad: document.querySelector('#movie_player.ad-showing') !== null,
          bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''),
          time: document.querySelector('#movie_player video')?.currentTime ?? 0,
        }))
        .catch(() => null);
      if (s) {
        row.adShowing ||= s.ad;
        row.botCheck ||= s.bot;
        row.playedTo = Math.max(row.playedTo, Math.round(s.time));
        row.endedAt = Math.round(s.time);
        const at = Math.round((Date.now() - start) / 100) / 10;
        const time = Math.round(s.time * 10) / 10;
        // The video's own first frame: an ad's clock (ad-showing) and the 0 s of the load are not playback.
        if (!s.ad && s.time > 0.5) row.content = row.content ? { ...row.content, lastAt: at, to: time } : { at, from: time, lastAt: at, to: time };
      }
      await sleep(500);
    }
    row.seconds = Math.round((Date.now() - start) / 1000);
    row.consent = new URL(page.url()).hostname.startsWith('consent.');
  } catch (e) {
    row.error = String(e?.message ?? e).split('\n')[0];
  }
  await page.close();
  return row;
}

const why = (r) => (r.botCheck ? 'YouTube asked this address to sign in (bot check)' : r.consent ? 'consent page' : r.error);
let ctx;
let skipped = 0;
let inconclusive = 0;
try {
  // The control has no extension at all: only an ad there shows that YouTube served one to this address.
  ({ ctx } = await launch({ mapHosts: false, extension: false, extraArgs: ARGS }));
  const control = {};
  for (const id of VIDEOS) {
    control[id] = await watch(ctx, id);
    console.log(`without Sieve  ${JSON.stringify(control[id])}`);
  }
  await ctx.close();

  let sw;
  let id;
  ({ ctx, sw, id } = await launch({ mapHosts: false, extraArgs: ARGS }));
  await sleep(1000); // onInstalled stores the default settings
  for (const id of VIDEOS) {
    const r = await watch(ctx, id);
    const c = control[id];
    console.log(`with Sieve     ${JSON.stringify(r)}`);
    if (why(r) || why(c)) {
      skipped++;
      console.log(`SKIP  ${id}: ${why(r) ?? why(c)}`);
      continue;
    }
    const play = judgePlayback(c, r);
    if (play.verdict === 'inconclusive') console.log(`INCONCLUSIVE  ${id}: ${play.text}`);
    else check(`live ${id}: the video keeps playing with Sieve, ${play.text}`, play.verdict === 'pass', JSON.stringify({ control: c, sieve: r }));
    if (c.adShowing || r.adShowing) {
      check(`live ${id}: ${c.adShowing ? 'an ad showed without Sieve' : 'no ad showed without Sieve'}, and none showed with Sieve`, !r.adShowing, JSON.stringify({ control: c, sieve: r }));
    } else {
      inconclusive++;
      console.log(`INCONCLUSIVE  ${id}: no ad was served, so removal cannot be shown`);
    }
  }

  let modules = [];
  try {
    modules = (await ytModules()).filter(([, mod]) => mod.importError || typeof mod.live === 'function');
  } catch (e) {
    check('the YouTube live modules were listed', false, String(e?.message ?? e));
  }
  const page = await ctx.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${VIDEOS[0]}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await page
    .waitForFunction(() => document.querySelector('ytd-watch-metadata') && typeof document.querySelector('#movie_player')?.getPlayerState === 'function' && document.querySelector('#movie_player video'), null, { timeout: 30_000 })
    .catch(() => {});
  const gate = await page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).catch(() => ({ bot: false, consent: false }));
  if (gate.bot || gate.consent) console.log(`SKIP  YouTube page checks: ${gate.bot ? 'YouTube asked this address to sign in (bot check)' : 'consent page'}`);
  else {
    for (const [name, mod] of modules) {
      if (mod.importError) {
        check(`${name}: the module loads`, false, mod.importError);
        continue;
      }
      try {
        await mod.live({ ctx, sw, id, check, page, videoId: VIDEOS[0], shots: process.env.SHOTS ?? tmpdir() });
      } catch (e) {
        check(`${name}: the live checks finished without throwing`, false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
      }
    }
  }
  await page.close();

  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: false } });
  });
  const end = Date.now() + 10_000;
  while ((await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).length > 0 && Date.now() < end) await sleep(200);
  const pick = VIDEOS.find((id) => control[id].adShowing) ?? VIDEOS[0];
  const off = await watch(ctx, pick);
  console.log(`with Sieve off (not a check): ${off.adShowing ? 'an ad showed' : 'no ad showed'} on ${pick}  ${JSON.stringify(off)}`);
} catch (e) {
  check('the live run finished without an exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  await ctx?.close().catch(() => {});
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} live checks passed, ${inconclusive} inconclusive, ${skipped} skipped`);
const code = exitCode({ failed: results.filter((r) => !r.ok).length, videos: VIDEOS.length, skipped, inconclusive });
// Exit 2 means no ad was served (or every video was skipped); playback checks that ran (all passed, or the exit would be 1) still count.
if (code === 2 && results.length > 0) console.log('NO EVIDENCE about ad removal (no ad was served); the playback checks above still stand.');
else if (code === 2) console.log('NO EVIDENCE: every video was skipped or showed no ad, so this run shows nothing about Sieve. Run it again from another network, or watch the videos by hand.');
process.exit(code);
