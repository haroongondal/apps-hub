// `test:e2e -- --live`: real youtube.com, signed out, fresh profiles. A bot-check page is what this address got, not a Sieve failure.
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results } from './harness.mjs';

const VIDEOS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0'];
const SECONDS = 30;
const ARGS = ['--autoplay-policy=no-user-gesture-required'];
// A video that stalled with Sieve (kJQP7kiw5Fk) still got past 5 s: it has to keep up with the extension-free control instead.
const MIN_RATIO = 0.6;
const MIN_CONTROL_S = 5;

// control.playedTo is the furthest the control got (an ad's own clock can reset it); sieve.endedAt is where the video was when the window closed.
export function judgePlayback(control, sieve) {
  if (!(control.playedTo > MIN_CONTROL_S)) return { verdict: 'inconclusive', ratio: null, text: `the control only reached ${control.playedTo} s, so playback cannot be compared` };
  const ratio = sieve.endedAt / control.playedTo;
  return { verdict: ratio >= MIN_RATIO ? 'pass' : 'fail', ratio, text: `with Sieve ${sieve.endedAt} s at the end of the window, the control ${control.playedTo} s, ratio ${ratio.toFixed(2)} (needs ${MIN_RATIO})` };
}

// Exit status: 1 when a check failed, 2 when no video gave evidence (every one skipped or inconclusive), else 0.
export function exitCode({ failed, videos, skipped, inconclusive }) {
  if (failed) return 1;
  return videos - skipped - inconclusive > 0 ? 0 : 2;
}

if (process.argv.includes('--self-check')) {
  const assert = (await import('node:assert/strict')).default;
  assert.equal(judgePlayback({ playedTo: 28 }, { endedAt: 27 }).verdict, 'pass');
  assert.equal(judgePlayback({ playedTo: 28 }, { endedAt: 17 }).verdict, 'pass', '17/28 = 0.61');
  assert.equal(judgePlayback({ playedTo: 28 }, { endedAt: 16 }).verdict, 'fail', '16/28 = 0.57');
  assert.equal(judgePlayback({ playedTo: 28 }, { endedAt: 6 }).verdict, 'fail', 'a stall past 5 s no longer passes');
  assert.equal(judgePlayback({ playedTo: 4 }, { endedAt: 28 }).verdict, 'inconclusive', 'a control that did not play cannot be compared');
  assert.equal(judgePlayback({ playedTo: 0 }, { endedAt: 0 }).verdict, 'inconclusive');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 3, inconclusive: 0 }), 2, 'all skipped is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 2 }), 2, 'skipped plus inconclusive is no evidence');
  assert.equal(exitCode({ failed: 0, videos: 3, skipped: 1, inconclusive: 1 }), 0);
  assert.equal(exitCode({ failed: 1, videos: 3, skipped: 3, inconclusive: 0 }), 1, 'a failure wins');
  console.log('self-check ok');
  process.exit(0);
}

async function watch(ctx, id) {
  const page = await ctx.newPage();
  const row = { id, seconds: 0, adShowing: false, botCheck: false, consent: false, playedTo: 0, endedAt: 0 };
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
  ({ ctx, sw } = await launch({ mapHosts: false, extraArgs: ARGS }));
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
if (code === 2) console.log('NO EVIDENCE: every video was skipped or showed no ad, so this run shows nothing about Sieve. Run it again from another network, or watch the videos by hand.');
process.exit(code);
