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
  // The page says "Done" only after the relay has stored every result, so the status text is the signal.
  await spike.waitForFunction(() => { const t = document.getElementById('status').textContent; return t && t !== 'Running the probes...'; }, null, { timeout: 90_000 });
  const status = await spike.locator('#status').innerText();
  if (status !== 'Done. Results below.') throw new Error(`Run all did not finish: ${status}`);

  const probes = await spike.evaluate(() => chrome.storage.local.get(null).then((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('probe:')).sort())));
  const keys = Object.keys(probes);
  if (!keys.length) throw new Error('no probe results were stored');
  for (const r of Object.values(probes)) {
    console.log(JSON.stringify(await spike.evaluate((x) => summarise(x), r)));
    if (!r.error && r.playability !== 'OK') console.log(`  ${r.strategy}: playability is ${r.playability} (${r.reason})${r.playability === 'LOGIN_REQUIRED' ? '; on a bot check, rerun with HEADLESS=0' : ''}`);
  }
  const label = Object.values(probes).some((r) => r.loggedIn) ? 'signed-in' : 'signed-out';
  writeFileSync(join(SCRATCH, `spike-${label}.json`), JSON.stringify(probes, null, 2));
  if (Object.values(probes).every((r) => r.error)) throw new Error('every probe recorded an error');

  const fixtureObj = (await stored('fixture')) ?? {};
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
  failed = file?.label !== label || keys.some((k) => !file.results[k]);
} catch (e) {
  failed = true;
  console.error(String(e?.stack ?? e).split('\n').slice(0, 4).join('\n'));
} finally {
  await ctx?.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
