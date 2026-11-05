// Drives the spike the way the owner will: open a video, open spike.html, click "Run all", then "Save results".
// Needs playwright-core and a Chromium: set PLAYWRIGHT_CORE and CHROMIUM_PATH if yours live elsewhere. HEADLESS=0 shows the window; VIDEO=<id> picks another video.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const SCRATCH = process.env.SHOTS ?? tmpdir();
const EXT = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE = join(EXT, 'fixtures/player-response.json');
const VIDEO = process.env.VIDEO ?? 'aqz-KE-bpKQ';

const profile = mkdtempSync(join(tmpdir(), 'sieve-spike-'));
let ctx;
let failed = false;
try {
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM, headless: process.env.HEADLESS !== '0',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;

  const video = await ctx.newPage();
  await video.goto(`https://www.youtube.com/watch?v=${VIDEO}`, { waitUntil: 'domcontentloaded' });
  const reject = video.getByRole('button', { name: 'Reject all' }).first();
  await Promise.race([reject.waitFor({ timeout: 15_000 }), video.locator('#movie_player').waitFor({ timeout: 15_000 })]).catch(() => {});
  if (await reject.isVisible()) {
    await reject.click();
    await video.waitForURL(/youtube\.com\/watch/);
  }
  await video.locator('#movie_player').waitFor({ timeout: 20_000 });
  await video.waitForLoadState('load', { timeout: 30_000 });
  await video.waitForTimeout(1_000);

  const spike = await ctx.newPage();
  await spike.goto(`chrome-extension://${id}/spike.html`);
  await spike.getByRole('button', { name: 'Run all' }).click();

  const stored = (key) => spike.evaluate((k) => chrome.storage.local.get(k).then((o) => o[k]), key);
  let s1;
  for (let i = 0; i < 40 && !s1; i++) {
    s1 = await stored('probe:S1');
    if (!s1) await spike.waitForTimeout(500);
  }
  if (!s1) throw new Error(`no probe:S1 within 20 s; the page says: ${await spike.locator('#status').innerText()}`);
  if (s1.error) throw new Error(`probe:S1 recorded an error: ${s1.error}`);

  const summary = await spike.evaluate((r) => summarise(r), s1);
  console.log(JSON.stringify(summary, null, 2));
  if (s1.playability !== 'OK') console.log(`playability is ${s1.playability} (${s1.reason}); on a bot check, rerun with HEADLESS=0`);
  writeFileSync(join(SCRATCH, `spike-${s1.loggedIn ? 'signed-in' : 'signed-out'}.json`), JSON.stringify(s1, null, 2));

  const fixtureObj = await stored('fixture');
  const fixture = JSON.stringify(fixtureObj, null, 2);
  const SECRET_KEY = /servingdata|trackingparams|baseurl|url$|token$|^signaturecipher$/i;
  const leaks = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}/${k}`);
    else if (typeof v === 'string' && (SECRET_KEY.test(path.split('/').pop()) || /^https?:\/\//.test(v)) && v !== 'https://example.invalid/stream') leaks.push(path);
  };
  walk(fixtureObj, '');
  if (/googlevideo|visitorData/i.test(fixture)) leaks.push('googlevideo or visitorData in the text');
  if (leaks.length) throw new Error(`fixture still holds unscrubbed values (${leaks.slice(0, 5).join(', ')}); not writing it`);
  const ads = ['adPlacements', 'adSlots', 'playerAds'].filter((k) => k in fixtureObj);
  if (ads.length) {
    mkdirSync(join(EXT, 'fixtures'), { recursive: true });
    writeFileSync(FIXTURE, `${fixture}\n`);
    console.log(`fixture written for ${VIDEO} (ad fields: ${ads.join(', ')})`);
  } else {
    console.log(`fixture not written: ${VIDEO} has no ad placements; rerun with VIDEO=<a monetised video>`);
  }

  await spike.getByRole('button', { name: 'Save results' }).click();
  await spike.getByText(/^Saved Downloads\/sieve-spike-/).waitFor({ timeout: 10_000 });
  let saved;
  for (let i = 0; i < 20 && !saved; i++) {
    [saved] = await spike.evaluate(() => chrome.downloads.search({ state: 'complete' }));
    if (!saved) await spike.waitForTimeout(500);
  }
  const file = saved && JSON.parse(readFileSync(saved.filename, 'utf8'));
  console.log(`saved: label ${file?.label}, results ${Object.keys(file?.results ?? {}).join(', ')}`);
  failed = file?.label !== (s1.loggedIn ? 'signed-in' : 'signed-out') || !file.results['probe:S1'];
} catch (e) {
  failed = true;
  console.error(String(e?.stack ?? e).split('\n').slice(0, 4).join('\n'));
} finally {
  await ctx?.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
