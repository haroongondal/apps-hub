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
  await video.goto(`https://www.youtube.com/watch?v=${VIDEO}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const reject = video.getByRole('button', { name: 'Reject all' }).first();
  await Promise.race([reject.waitFor({ timeout: 15_000 }), video.locator('#movie_player').waitFor({ timeout: 15_000 })]).catch(() => {});
  if (await reject.isVisible()) {
    await reject.click();
    await video.waitForURL(/youtube\.com\/watch/);
  }
  await video.locator('#movie_player').waitFor({ timeout: 60_000 });
  await video.waitForLoadState('load', { timeout: 60_000 });
  await video.waitForTimeout(1_000);

  const spike = await ctx.newPage();
  await spike.goto(`chrome-extension://${id}/spike.html`);
  await spike.getByRole('button', { name: 'Run all' }).click();

  const stored = (key) => spike.evaluate((k) => chrome.storage.local.get(k).then((o) => o[k]), key);
  // The status stays aria-busy until Run all ends, and its text changes as it goes. The downloads announce their size first.
  const idle = () => !document.getElementById('status').hasAttribute('aria-busy');
  await spike.waitForFunction(() => document.getElementById('status').dataset.expectBytes || !document.getElementById('status').hasAttribute('aria-busy'), null, { timeout: 240_000 });
  const expect = Number(await spike.locator('#status').getAttribute('data-expect-bytes')) || 0;
  // A 1 MB/s floor plus half again and 2 min: a link at that floor still finishes (the first try, with only 2 min, cut a 1 MB/s run short).
  const downloadMs = Math.min(30 * 60_000, (expect / 1e6) * 1500 + 120_000);
  try { await spike.waitForFunction(idle, null, { timeout: downloadMs }); }
  catch {
    const dl = await stored('probe:DL');
    if (dl) console.log(`downloads so far: ${JSON.stringify(dl.streams?.map(({ itag, bytes, ms, mbps, reason }) => ({ itag, bytes, ms, mbps, reason })))} baseline ${JSON.stringify(dl.baseline)}`);
    throw new Error(`Run all did not finish within ${Math.round(downloadMs / 60_000)} min for ${Math.round(expect / 1e6)} MB; status: ${await spike.locator('#status').innerText()}`);
  }
  const status = await spike.locator('#status').innerText();
  if (status !== 'Done. Results below.') throw new Error(`Run all did not finish: ${status}`);

  const probes = await spike.evaluate(() => chrome.storage.local.get(null).then((o) => Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('probe:')).sort())));
  const keys = Object.keys(probes);
  if (!keys.length) throw new Error('no probe results were stored');
  const STREAM_LEAK = /googlevideo|signaturecipher|[?&](?:n|s|sig|lsig|signature)=/i;
  if (STREAM_LEAK.test(JSON.stringify(probes))) throw new Error('a probe result holds a stream URL or cipher; not printing or saving');
  for (const r of Object.values(probes)) {
    console.log(JSON.stringify(await spike.evaluate((x) => summarise(x), r)));
    if (!r.error && 'playability' in r && r.playability !== 'OK') console.log(`  ${r.strategy}: playability is ${r.playability} (${r.reason})${r.playability === 'LOGIN_REQUIRED' ? '; on a bot check, rerun with HEADLESS=0' : ''}`);
  }
  const dl = probes['probe:DL'];
  if (dl?.baseline) console.log(`baseline: ${dl.baseline.error ?? `${dl.baseline.mbps} MB/s (${dl.baseline.host}, ${dl.baseline.bytes} bytes in ${(dl.baseline.ms / 1000).toFixed(1)} s)`}`);
  if (dl?.streams?.length) {
    console.log('| itag | height | codec | mode | bytes | seconds | MB/s | x bitrate | Q1 | Q2 | pass |');
    for (const x of dl.streams) console.log(`| ${x.itag} | ${x.height ?? ''} | ${/codecs="([^"]+)"/.exec(x.mimeType ?? '')?.[1] ?? ''} | ${x.mode} | ${x.bytes} of ${x.contentLength} | ${(x.ms / 1000).toFixed(1)} | ${x.mbps} | ${x.xBitrate} | ${x.q1} | ${x.q2} | ${x.pass}${x.reason ? ` (${x.reason})` : ''} |`);
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
  const text = saved ? readFileSync(saved.filename, 'utf8') : 'null';
  const file = JSON.parse(text);
  console.log(`saved: label ${file?.label}, results ${Object.keys(file?.results ?? {}).join(', ')}`);
  if (STREAM_LEAK.test(text)) console.error('the saved file holds a stream URL or cipher');
  failed = file?.label !== label || keys.some((k) => !file.results[k]) || STREAM_LEAK.test(text);
} catch (e) {
  failed = true;
  console.error(String(e?.stack ?? e).split('\n').slice(0, 4).join('\n'));
} finally {
  await ctx?.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
