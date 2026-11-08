// `test:e2e -- --live`: real youtube.com, signed out, fresh profiles. A bot-check page is what this address got, not a Sieve failure.
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results } from './harness.mjs';

const VIDEOS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0'];
const SECONDS = 30;
const ARGS = ['--autoplay-policy=no-user-gesture-required'];

async function watch(ctx, id) {
  const page = await ctx.newPage();
  const row = { id, seconds: 0, adShowing: false, botCheck: false, consent: false, playedTo: 0 };
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
        .catch(() => ({ ad: false, bot: false, time: 0 }));
      row.adShowing ||= s.ad;
      row.botCheck ||= s.bot;
      row.playedTo = Math.max(row.playedTo, Math.round(s.time));
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
    check(`live ${id}: the video plays with Sieve (to ${r.playedTo} s in ${r.seconds} s)`, r.playedTo > 5, JSON.stringify(r));
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
process.exit(results.every((r) => r.ok) ? 0 : 1);
