// `test:e2e -- --live`: real youtube.com, signed out, fresh profiles. A bot-check page is what this address got, not a Sieve failure.
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results } from './harness.mjs';
import { ytModules } from './yt/helpers.mjs';

const VIDEOS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0'];
const SECONDS = 30;
const ARGS = ['--autoplay-policy=no-user-gesture-required'];
// A video that stalled with Sieve (kJQP7kiw5Fk, Phase 1) still got past 5 s: playback is judged as a rate from the first frame.
const MIN_RATIO = 0.6;
const MIN_CONTROL_S = 5;
// First frame with Sieve minus without it, 2026-11-17, signed out (start = window second minus video time at the first frame sampled
// without an ad): 15 of 16 pairs where the control showed no ad were -5.8 to +4.0 s, one was +18.9 s (dQw4w9WgXcQ); the slowest start
// without Sieve and without an ad was 8.3 s. Where the control showed an ad, Sieve started 5.4 to 25.4 s before its video.
const START_SLACK_S = 10;

// Rejects after `ms`: a hung page (a page.close hung for 11 minutes on 2026-11-17) fails that video instead of hanging the run.
export function within(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(timer));
}

// When the video was at 0 s, in window seconds; null when it never played without an ad, or when its first frame came more than 5 s
// into the video (a resumed video shows no start).
const startOf = (row) => (row.content && row.content.from <= 5 ? Math.round((row.content.at - row.content.from) * 10) / 10 : null);

// The window opens at domcontentloaded, so it also holds the wait for the first frame: up to 9.2 s without Sieve (20 s only after an ad)
// and up to 20.6 s with it (30 live runs, 2026-11-17), while no video stalled once it had started. So the first frame is judged against
// the control's here, and playback from it in judgePlayback. A control that showed only an ad counts as starting at the window's end.
export function judgeStart(control, sieve) {
  if (!(control.playedTo > MIN_CONTROL_S)) return { verdict: 'inconclusive', text: `the control only reached ${control.playedTo} s` };
  const s = startOf(sieve);
  const c = startOf(control) ?? SECONDS;
  const text = `first frame with Sieve at ${s === null ? 'none' : `${s} s`}, without it at ${startOf(control) === null ? `none (only an ad), counted as ${SECONDS} s` : `${c} s`} (allowed ${START_SLACK_S} s later)`;
  return { verdict: s !== null && s - c <= START_SLACK_S ? 'pass' : 'fail', text };
}

// sieve.content: window second and video time of the first frame sampled without an ad, and the video time of the last;
// sieve.windowEnd: when the window closed, so a video that dies after its first frame counts the dead time too.
// control.playedTo, the furthest the control got (an ad's clock counts), only shows that YouTube served this address a video.
export function judgePlayback(control, sieve) {
  if (!(control.playedTo > MIN_CONTROL_S)) return { verdict: 'inconclusive', ratio: null, text: `the control only reached ${control.playedTo} s, so playback cannot be compared` };
  const c = sieve.content;
  const span = c ? sieve.windowEnd - c.at : 0;
  if (!c || span < MIN_CONTROL_S) return { verdict: 'fail', ratio: null, text: `with Sieve the video ${c ? `only started at ${c.at} s` : 'never started'} in the ${SECONDS} s window` };
  const ratio = (c.to - c.from) / span;
  return { verdict: ratio >= MIN_RATIO ? 'pass' : 'fail', ratio, text: `with Sieve it played ${(c.to - c.from).toFixed(1)} s of video in the ${span.toFixed(1)} s from its first frame to the end of the window, ratio ${ratio.toFixed(2)} (needs ${MIN_RATIO})${sieve.hung ? `; ${sieve.hung}` : ''}` };
}

const why = (r) => (r.botCheck ? 'YouTube asked this address to sign in (bot check)' : r.consent ? 'consent page' : r.error);

// Only a late first frame on a video that did start earns a second watch: a video that never started is a failure as it is.
export const needsRewatch = (control, first) => first.content !== null && judgeStart(control, first).verdict === 'fail';

// The second watch decides the start check alone; playback and the ad check stay with the first watch (an ad on either counts),
// and a second watch that gave no answer (bot check, consent page, error) leaves the late start a failure.
export function judgeVideo(control, first, again = null) {
  let start = judgeStart(control, first);
  if (again && needsRewatch(control, first)) {
    const second = judgeStart(control, again);
    start = why(again)
      ? { verdict: 'fail', text: `${start.text}; the second watch gave no answer (${why(again)})` }
      : { verdict: second.verdict, text: `on the first watch ${start.text}; on the second ${second.text}`, recovered: second.verdict === 'pass' };
  }
  return { start, play: judgePlayback(control, first), ad: first.adShowing || !!again?.adShowing };
}

// Exit status: 1 when a check failed, 2 when no video gave evidence (every one skipped or inconclusive), else 0.
export function exitCode({ failed, videos, skipped, inconclusive }) {
  if (failed) return 1;
  return videos - skipped - inconclusive > 0 ? 0 : 2;
}

if (process.argv.includes('--self-check')) {
  const assert = (await import('node:assert/strict')).default;
  const played = (at, from, to, windowEnd = 30) => ({ windowEnd, content: { at, from, to } });
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 29.5)).verdict, 'pass');
  assert.equal(judgePlayback({ playedTo: 29 }, played(17, 0.6, 13.1)).verdict, 'pass', 'run 2: a first frame at 17 s, then steady playback (was 13/29 = 0.45)');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 18.3)).verdict, 'pass', '17.8/29 = 0.61');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 17.3)).verdict, 'fail', '16.8/29 = 0.58');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.5, 6)).verdict, 'fail', 'a stall after the first frame fails');
  assert.equal(judgePlayback({ playedTo: 28 }, played(1, 0.6, 6.6)).verdict, 'fail', 'a video that died 6 s after its first frame fails: the dead time to the window end counts');
  assert.equal(judgePlayback({ playedTo: 10 }, played(1, 0, 6, 11)).verdict, 'pass', 'a ratio of exactly 0.6 passes');
  assert.equal(judgePlayback({ playedTo: 28 }, { windowEnd: 30, content: null }).verdict, 'fail', 'a video that never started with Sieve fails');
  assert.equal(judgePlayback({ playedTo: 28 }, played(25, 0.5, 5.5)).verdict, 'pass', 'a span of exactly 5 s is judged');
  assert.equal(judgePlayback({ playedTo: 28 }, played(25.1, 0.5, 5.4)).verdict, 'fail', 'a first frame under 5 s before the end shows no playback: a failure');
  assert.equal(judgePlayback({ playedTo: 17, content: null }, played(5.5, 0.4, 24.9)).verdict, 'pass', 'a control that showed only an ad still lets the check run');
  assert.equal(judgePlayback({ playedTo: 4 }, played(1, 0.5, 29.5)).verdict, 'inconclusive', 'a control that did not play cannot be compared');
  assert.equal(judgePlayback({ playedTo: 5 }, played(1, 0.5, 29.5)).verdict, 'inconclusive', 'a control of exactly 5 s cannot be compared');
  const control = (at, from) => ({ playedTo: 28, content: { at, from, to: 28 } });
  assert.equal(judgeStart(control(1.5, 0.5), played(21.5, 0.5, 9)).verdict, 'fail', 'a first frame at 21 s against the control at 1 s is late');
  assert.equal(judgeStart(control(0.8, 0), played(20.6, 0.9, 10.2)).verdict, 'fail', 'run r3 on 2026-11-17: 19.7 s against 0.8 s');
  assert.equal(judgeStart(control(2, 0.5), played(9.5, 0.5, 21)).verdict, 'pass', '9 s against 1.5 s is not late');
  assert.equal(judgeStart(control(1.5, 0.5), played(11.5, 0.5, 19)).verdict, 'pass', 'exactly the slack (11 s against 1 s) passes');
  assert.equal(judgeStart(control(1.5, 0.5), played(11.6, 0.5, 19)).verdict, 'fail', 'just over the slack fails');
  assert.equal(judgeStart({ playedTo: 17, content: null }, played(10.5, 0.5, 20)).verdict, 'pass', 'against a control that showed only an ad, 10 s is not late');
  assert.equal(judgeStart(control(1.5, 0.5), { content: null }).verdict, 'fail', 'no first frame with Sieve is late');
  assert.equal(judgeStart({ playedTo: 3, content: null }, { content: null }).verdict, 'inconclusive', 'a control that did not play cannot be compared');
  await assert.rejects(within(new Promise(() => {}), 20, 'a hung call'), /a hung call took over 0.02 s/);
  assert.equal(await within(Promise.resolve(7), 20, 'a quick call'), 7);
  assert.equal(judgeStart(control(1.5, 0.5), played(2, 12, 40)).verdict, 'fail', 'a first frame 12 s into the video (resumed) is no start');
  assert.match(judgePlayback({ playedTo: 28 }, { ...played(1, 0.5, 6.6), hung: 'a page check took over 5 s' }).text, /a page check took over 5 s/);
  const never = { windowEnd: 30, content: null, adShowing: false };
  assert.equal(needsRewatch(control(1.5, 0.5), never), false, 'a video that never started is not watched again');
  const v1 = judgeVideo(control(1.5, 0.5), never, played(2, 0.5, 28));
  assert.deepEqual([v1.start.verdict, v1.play.verdict], ['fail', 'fail'], 'a first watch that never started fails, whatever a second watch shows');
  const late = { ...played(21.5, 0.5, 9), adShowing: true };
  assert.equal(needsRewatch(control(1.5, 0.5), late), true);
  const v2 = judgeVideo(control(1.5, 0.5), late, played(2, 0.5, 28));
  assert.deepEqual([v2.start.verdict, v2.start.recovered, v2.play.verdict, v2.ad], ['pass', true, 'pass', true], 'late then on time: the start passes, playback and the ad stay with the first watch');
  const v3 = judgeVideo(control(1.5, 0.5), late, played(22, 0.5, 8.5));
  assert.equal(v3.start.verdict, 'fail', 'late twice fails');
  const v4 = judgeVideo(control(1.5, 0.5), late, { botCheck: true, content: null, adShowing: false });
  assert.deepEqual([v4.start.verdict, v4.ad], ['fail', true], 'a second watch that hit a bot check keeps the late start and the first ad');
  const v5 = judgeVideo(control(1.5, 0.5), { ...played(1.5, 0.5, 2), windowEnd: 30 }, null);
  assert.deepEqual([v5.start.verdict, v5.play.verdict], ['pass', 'fail'], 'a start on time with a stall needs no second watch and fails playback');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 3, inconclusive: 0 }), 2, 'all skipped is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 2 }), 2, 'skipped plus inconclusive is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 1 }), 0);
  assert.equal(exitCode({ failed: 1, videos: 3, skipped: 3, inconclusive: 0 }), 1, 'a failure wins');
  console.log('self-check ok');
  process.exit(0);
}

async function watch(ctx, id, extra = '') {
  const page = await ctx.newPage();
  // firstAny: the window second of the first frame of anything, ad or video (data only, nothing judges it yet).
  const row = { id, seconds: 0, adShowing: false, botCheck: false, consent: false, playedTo: 0, endedAt: 0, content: null, firstAny: null, windowEnd: 0 };
  try {
    await page.goto(`https://www.youtube.com/watch?v=${id}${extra}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const start = Date.now();
    while (Date.now() - start < SECONDS * 1000) {
      const s = await within(
        page.evaluate(() => ({
          ad: document.querySelector('#movie_player.ad-showing') !== null,
          bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''),
          time: document.querySelector('#movie_player video')?.currentTime ?? 0,
        })),
        5000,
        'a page check',
      ).catch((e) => {
        row.hung ??= String(e?.message ?? e).split('\n')[0];
        return null;
      });
      if (s) {
        row.adShowing ||= s.ad;
        row.botCheck ||= s.bot;
        row.playedTo = Math.max(row.playedTo, Math.round(s.time));
        row.endedAt = Math.round(s.time);
        const at = Math.round((Date.now() - start) / 100) / 10;
        const time = Math.round(s.time * 10) / 10;
        if (s.time > 0.5) row.firstAny ??= at;
        // The video's own first frame: an ad's clock (ad-showing) and the 0 s of the load are not playback.
        if (!s.ad && s.time > 0.5) row.content = row.content ? { ...row.content, to: time } : { at, from: time, to: time };
      }
      await sleep(500);
    }
    row.windowEnd = Math.round((Date.now() - start) / 100) / 10;
    row.seconds = Math.round(row.windowEnd);
    row.consent = new URL(page.url()).hostname.startsWith('consent.');
  } catch (e) {
    row.error = String(e?.message ?? e).split('\n')[0];
  }
  // A close that hangs leaves this video's numbers as they are and the run goes on.
  await within(page.close(), 10_000, 'closing the page').catch((e) => (row.hung ??= e.message));
  return row;
}

let ctx;
let skipped = 0;
let inconclusive = 0;
let recovered = 0;
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
    // A late first frame gets one more watch from 0 s, in Sieve's browser only: the control's browser is closed by now and its start stays
    // the baseline. A one-off network wait does not repeat; a player held back by Sieve, or by YouTube's reaction to it, does.
    let again = null;
    if (needsRewatch(c, r)) {
      console.log(`LATE  ${id}: ${judgeStart(c, r).text}; watching it once more`);
      again = await watch(ctx, id, '&t=0s');
      console.log(`with Sieve, again  ${JSON.stringify(again)}`);
    }
    const { start, play, ad } = judgeVideo(c, r, again);
    if (start.recovered) recovered++;
    const rows = JSON.stringify({ control: c, sieve: r, again });
    if (start.verdict === 'inconclusive') console.log(`INCONCLUSIVE  ${id}: ${start.text}`);
    else check(`live ${id}: the first frame with Sieve is not late, ${start.text}`, start.verdict === 'pass', rows);
    if (play.verdict === 'inconclusive') console.log(`INCONCLUSIVE  ${id}: ${play.text}`);
    else check(`live ${id}: the video keeps playing with Sieve, ${play.text}`, play.verdict === 'pass', rows);
    if (c.adShowing || ad) {
      check(`live ${id}: ${c.adShowing ? 'an ad showed without Sieve' : 'no ad showed without Sieve'}, and none showed with Sieve`, !ad, rows);
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

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} live checks passed, ${inconclusive} inconclusive, ${skipped} skipped, ${recovered} late on the first watch and on time on the second`);
const code = exitCode({ failed: results.filter((r) => !r.ok).length, videos: VIDEOS.length, skipped, inconclusive });
// Exit 2 means no ad was served (or every video was skipped); playback checks that ran (all passed, or the exit would be 1) still count.
if (code === 2 && results.length > 0) console.log('NO EVIDENCE about ad removal (no ad was served); the playback checks above still stand.');
else if (code === 2) console.log('NO EVIDENCE: every video was skipped or showed no ad, so this run shows nothing about Sieve. Run it again from another network, or watch the videos by hand.');
process.exit(code);
