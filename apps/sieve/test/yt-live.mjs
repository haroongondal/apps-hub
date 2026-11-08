// `test:e2e -- --live`: real youtube.com, signed out, fresh profile. A bot-check page is what this address got, not a Sieve failure.
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch, results } from './harness.mjs';

const VIDEOS = ['dQw4w9WgXcQ', 'kJQP7kiw5Fk', '9bZkp7q19f0'];
const SECONDS = 30;

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
  console.log(JSON.stringify(row));
  return row;
}

let skipped = 0;
try {
  const { ctx, sw } = await launch({ mapHosts: false, extraArgs: ['--autoplay-policy=no-user-gesture-required'] });
  await sleep(1000); // onInstalled stores the default settings
  for (const id of VIDEOS) {
    const r = await watch(ctx, id);
    if (r.botCheck || r.consent || r.error) {
      skipped++;
      console.log(`SKIP  ${id}: ${r.botCheck ? 'YouTube asked this address to sign in (bot check)' : r.consent ? 'consent page' : r.error}`);
    } else check(`live ${id}: no ad showed in ${r.seconds} s, and the video played (to ${r.playedTo} s)`, !r.adShowing && r.playedTo > 5, JSON.stringify(r));
  }
  // A control, not a check: with Sieve off, does this address get ads at all? Without them the runs above prove little.
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: false } });
  });
  const control = await watch(ctx, VIDEOS[0]);
  console.log(`control with Sieve off: ${control.adShowing ? 'an ad showed' : 'no ad showed'} on ${VIDEOS[0]}`);
  await ctx.close();
} catch (e) {
  check('the live run finished without an exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} live checks passed, ${skipped} skipped`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
