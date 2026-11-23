// Anti-goal 1, browsing does not slow down: with dist/ against no extension in fresh profiles, local DCL at most +20 ms and cold load within 1.10x on 4 of 5 real sites.
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs');
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = fileURLToPath(new URL('../dist', import.meta.url));
const BUILD_HINT = `run \`pnpm --filter sieve build\` and check that ${EXT} has a manifest.json`;

const num = (key, fallback) => {
  const v = process.env[key];
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isFinite(n) || n < 0) throw setupError(`${key} must be a number of 0 or more, got "${v}"`);
  return n;
};
let LOCAL_RUNS = 20;
let SITE_RUNS = 5;
let LOAD_MS = 60_000;
let TOTAL_MS = 30 * 60_000;
let SETTLE_MS = 1000;
let SITES = ['https://www.theguardian.com/', 'https://www.bbc.com/news', 'https://www.npr.org/', 'https://www.nbcnews.com/', 'https://www.wired.com/'];
function readEnv() {
  LOCAL_RUNS = num('LOCAL_RUNS', LOCAL_RUNS);
  SITE_RUNS = num('SITE_RUNS', SITE_RUNS);
  LOAD_MS = num('LOAD_TIMEOUT_MS', LOAD_MS);
  TOTAL_MS = num('TOTAL_TIMEOUT_MS', TOTAL_MS);
  SETTLE_MS = num('SETTLE_MS', SETTLE_MS);
  if (process.env.SITES !== undefined) SITES = process.env.SITES.split(',').map((s) => s.trim()).filter(Boolean);
}
const DCL_LIMIT_MS = 20;
const LOAD_RATIO = 1.1;
// shortcut: the last two host labels, so a redirect to another registrable domain is caught; wrong for co.uk-style hosts, fine for the default sites.
const tail = (host) => host.split('.').slice(-2).join('.');
const BOT_TITLE = /just a moment|access denied|attention required|captcha|are you a (robot|human)|pardon our interruption/i;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const within = (p, ms) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer after ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(timer));
};
const ok = (runs) => runs.filter((r) => r.ok);
const med = (runs, key) => median(ok(runs).map((r) => r[key]).filter(Number.isFinite));
const fmt = (n, digits) => (Number.isFinite(n) ? n.toFixed(digits) : 'n/a');
const reasons = (runs) => [...new Set(runs.filter((r) => !r.ok).map((r) => r.why))].join('; ');
const setupError = (message) => Object.assign(new Error(message), { setup: true });

const sides = [];
const closeAll = () => within(Promise.allSettled(sides.map((s) => s.ctx.close())), 10_000).catch(() => {});

async function launchSide(name, withExtension) {
  let chromium;
  try {
    ({ chromium } = await import(PLAYWRIGHT));
  } catch (e) {
    throw setupError(`could not load playwright-core from ${PLAYWRIGHT} (${String(e.message).split('\n')[0]}); set PLAYWRIGHT_CORE`);
  }
  const profile = mkdtempSync(join(tmpdir(), 'sieve-perf-'));
  const removeProfile = () => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      executablePath: CHROMIUM,
      headless: process.env.HEADLESS !== '0',
      args: withExtension ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
    });
  } catch (e) {
    removeProfile();
    throw setupError(`could not start Chromium at ${CHROMIUM} (${String(e.message).split('\n')[0]}); set CHROMIUM_PATH`);
  }
  process.on('exit', removeProfile);
  const side = { name, ctx, runs: [], info: '' };
  sides.push(side);
  if (withExtension) {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30_000 }).catch(() => null);
    if (!sw) throw setupError(`the extension's service worker did not start within 30 s; ${BUILD_HINT}`);
    let state = {};
    for (let i = 0; ; i++) {
      state = await sw.evaluate(async () => ({ rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(), scripts: (await chrome.scripting.getRegisteredContentScripts()).length })).catch((e) => ({ error: String(e.message).split('\n')[0] }));
      if (state.rulesets?.length && state.scripts) break;
      if (i >= 150) throw setupError(`the extension did not finish setting up within 15 s (${JSON.stringify(state)}); ${BUILD_HINT}`);
      await sleep(100);
    }
    side.info = `${new URL(sw.url()).host}: rulesets ${state.rulesets.join(', ')}; ${state.scripts} registered content scripts`;
  } else if (ctx.serviceWorkers().length) {
    throw setupError('the profile meant to run without the extension has a service worker');
  }
  return side;
}

async function measure(page, url, real) {
  const cdp = await page.context().newCDPSession(page);
  if (real) {
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.clearBrowserCookies');
  }
  const res = await page.goto(url, { waitUntil: 'load', timeout: LOAD_MS });
  if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
  const host = new URL(page.url()).hostname;
  if (tail(host) !== tail(new URL(url).hostname)) throw new Error(`redirected to ${host}`);
  const title = await page.title();
  if (BOT_TITLE.test(title)) throw new Error(`bot or consent page "${title.slice(0, 40)}"`);
  await page.waitForFunction(() => performance.getEntriesByType('navigation')[0]?.loadEventEnd > 0, null, { timeout: 5000 });
  const t = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  if (!real) return { ok: true, ...t };
  await sleep(SETTLE_MS);
  let heapMb = NaN;
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    heapMb = metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
  } catch {}
  return { ok: true, ...t, heapMb };
}

async function load(side, url, real) {
  let page;
  try {
    page = await within(side.ctx.newPage(), 15_000);
    return await within(measure(page, url, real), LOAD_MS + 30_000);
  } catch (e) {
    return { ok: false, why: String(e.message).split('\n')[0].replace(/^page\.goto: /, '').replace(/ at https?:\/\/\S+$/, '').replaceAll('|', '/').slice(0, 90) };
  } finally {
    if (page) await within(page.close(), 5000).catch(() => {});
  }
}

let stopped = false;

async function round(a, b, i, url, real) {
  if (stopped) throw setupError(`stopped: the run took more than ${TOTAL_MS / 1000} s`);
  for (const side of i % 2 ? [b, a] : [a, b]) side.runs.push(await load(side, url, real));
}

function localPart(a, b) {
  console.log(`\n### Local page (${LOCAL_RUNS} loads per profile, domContentLoadedEventEnd)\n`);
  console.log('| profile | loads ok | median DCL ms | min | max |\n| --- | --- | --- | --- | --- |');
  for (const s of [a, b]) {
    const d = ok(s.runs).map((r) => r.dcl);
    console.log(`| ${s.name} | ${d.length}/${s.runs.length} | ${d.length ? `${median(d).toFixed(1)} | ${Math.min(...d).toFixed(1)} | ${Math.max(...d).toFixed(1)}` : 'failed | |'} |`);
  }
  const failed = [a, b].filter((s) => !ok(s.runs).length);
  if (failed.length) return { pass: false, line: `Local page: FAIL, no load worked ${failed.map((s) => `${s.name}: ${reasons(s.runs)}`).join('; ')}` };
  const diff = med(a.runs, 'dcl') - med(b.runs, 'dcl');
  const pass = diff <= DCL_LIMIT_MS;
  return { pass, line: `Local page: median DCL ${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ms with the extension (limit +${DCL_LIMIT_MS} ms): ${pass ? 'PASS' : 'FAIL'}` };
}

// rows: [{ label, w, wo }], the runs with and without the extension. A side needs at least half the loads attempted (a site dropped after 2 rounds counts 2, not SITE_RUNS) to count; the extension side may not lose loads the other side kept.
export function judge(rows, runs = SITE_RUNS) {
  const need = Math.ceil((rows.length * 4) / 5);
  const sites = rows.map(({ label, w, wo }) => {
    const min = Math.max(1, Math.ceil(Math.min(runs, w.length, wo.length) / 2));
    const gw = ok(w).length;
    const gwo = ok(wo).length;
    if (gwo >= min && gw < gwo) return { label, status: 'lost', result: `fail: extension side lost loads (${gw} of ${w.length}; ${gwo} of ${wo.length} without)`, withWhy: reasons(w) };
    const few = [['with', w], ['without', wo]].filter(([, r]) => ok(r).length < min);
    if (few.length) return { label, status: 'excluded', result: `excluded (${few.map(([n, r]) => `${n}: ${ok(r).length} of ${r.length} loads worked${reasons(r) ? `, ${reasons(r)}` : ''}`).join('; ')})` };
    const ratio = med(w, 'load') / med(wo, 'load');
    return { label, status: ratio <= LOAD_RATIO ? 'pass' : 'slower', ratio, result: ratio <= LOAD_RATIO ? 'pass' : 'slower' };
  });
  const count = (status) => sites.filter((s) => s.status === status).length;
  const passed = count('pass');
  const pass = passed >= need && !count('lost');
  const hints = [];
  if (!pass && count('lost')) hints.push(`the extension side lost loads on ${sites.filter((s) => s.status === 'lost').map((s) => s.label).join(', ')}: a lost-load FAIL is re-run once, and the same site failing again with the extension means a real break (reproduce with HEADLESS=0 SITES=<url> and open the page by hand)`);
  if (!pass && count('excluded')) hints.push('the result column says why; re-run, try HEADLESS=0, or replace a site with SITES=...');
  const sitesWord = (n) => `${n} ${n === 1 ? 'site' : 'sites'}`;
  const extra = `${count('excluded') ? `; ${sitesWord(count('excluded'))} excluded (an excluded site cannot count as a pass)` : ''}${count('lost') ? `, but ${sitesWord(count('lost'))} lost loads with the extension, and a run with a lost-load site always fails` : ''}`;
  return { sites, passed, need, pass, hint: hints.join('; '), line: `Real sites: ${passed} of ${rows.length} within ${LOAD_RATIO.toFixed(2)}x load time (need ${need})${extra}: ${pass ? 'PASS' : 'FAIL'}` };
}

function sitesPart(rows) {
  const verdict = judge(rows);
  console.log(`\n### Real sites (${SITE_RUNS} cold loads per profile, medians)\n`);
  console.log('| site | with: DCL ms | with: load ms | with: heap MB | without: DCL ms | without: load ms | without: heap MB | load ratio | loads ok (with, without) | result |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const cell = (runs) => (ok(runs).length ? `${fmt(med(runs, 'dcl'), 0)} | ${fmt(med(runs, 'load'), 0)} | ${fmt(med(runs, 'heapMb'), 1)}` : 'failed | failed | failed');
  const notes = [];
  for (const [i, { label, w, wo }] of rows.entries()) {
    const v = verdict.sites[i];
    console.log(`| ${label} | ${cell(w)} | ${cell(wo)} | ${v.ratio ? `${v.ratio.toFixed(2)}x` : ''} | ${ok(w).length}/${w.length}, ${ok(wo).length}/${wo.length} | ${v.result} |`);
    if (v.status === 'lost' && v.withWhy) notes.push(`${label}: with the extension, ${v.withWhy}. Check by hand that the extension did not break the page.`);
    if ((v.status === 'pass' || v.status === 'slower') && (reasons(w) || reasons(wo))) notes.push(`${label}: some loads failed (with: ${reasons(w) || 'none'}; without: ${reasons(wo) || 'none'}); the medians use the loads that worked.`);
  }
  for (const n of notes) console.log(`\n${n}`);
  return verdict;
}

function selfCheck() {
  const runs = (n, bad, load) => Array.from({ length: n }, (_, i) => (i < bad ? { ok: false, why: 'HTTP 403' } : { ok: true, dcl: 1, load, heapMb: 1 }));
  const site = (label, w, wo) => ({ label, w, wo });
  const fine = (label, withLoad = 100) => site(label, runs(5, 0, withLoad), runs(5, 0, 100));
  const status = (rows) => judge(rows, 5);
  const five = (...changed) => ['a', 'b', 'c', 'd', 'e'].map((l, i) => changed[i] ?? fine(l));

  assert.equal(status(five()).pass, true, 'all five within 1.10x');
  assert.equal(status(five(fine('a', 110))).pass, true, 'exactly 1.10x counts');
  assert.equal(status(five(fine('a', 111))).pass, true, 'one slower site is allowed (4 of 5)');
  assert.equal(status(five(fine('a', 111), fine('b', 200))).pass, false, 'two slower sites fail');
  assert.equal(status(five(site('a', runs(5, 3, 100), runs(5, 0, 100)))).sites[0].status, 'lost', 'extension side lost 3 of 5');
  assert.equal(status(five(site('a', runs(5, 3, 100), runs(5, 0, 100)))).pass, false, 'lost loads fail the run even when 4 other sites pass');
  assert.match(status(five(site('a', runs(5, 1, 100), runs(5, 0, 100)))).sites[0].result, /^fail: extension side lost loads \(4 of 5/, 'one lost load is a loss too');
  assert.equal(status(five(site('a', runs(5, 4, 100), runs(5, 4, 100)))).sites[0].status, 'excluded', 'one good load per side is below the minimum of 3');
  assert.equal(status(five(site('a', runs(5, 4, 100), runs(5, 4, 100)))).pass, true, 'an excluded site is just not counted: the other 4 still make 4 of 5');
  assert.equal(status(five(site('a', runs(5, 4, 100), runs(5, 4, 100)), fine('b', 200))).pass, false, 'an excluded site never counts as a pass');
  assert.equal(status(five(site('a', runs(5, 0, 100), runs(5, 3, 100)))).sites[0].status, 'excluded', 'only the without side failed: excluded');
  assert.equal(status(five(site('a', runs(5, 0, 100), runs(5, 3, 100)))).hint, '', 'passing run needs no hint');
  assert.match(status(five(site('a', runs(2, 2, 100), runs(2, 2, 100)), site('b', runs(2, 2, 100), runs(2, 2, 100)))).hint, /replace a site with SITES/, 'excluded sites in a failing run say what to do');
  const dropped = status(five(site('a', runs(2, 2, 100), runs(2, 0, 100))));
  assert.equal(dropped.sites[0].status, 'lost', 'a site dropped after 2 rounds where the extension side lost both loads and the other kept both is lost, not excluded');
  assert.equal(dropped.pass, false, 'that run fails even though 4 sites pass');
  assert.match(dropped.hint, /re-run once/, 'a lost site says to re-run once');
  assert.match(dropped.line, /1 site lost loads with the extension, and a run with a lost-load site always fails: FAIL$/, 'the lost-site line reads as one sentence');
  assert.equal(status(five(site('a', runs(2, 1, 100), runs(2, 0, 100)))).sites[0].status, 'lost', 'dropped site: 1 of 2 with against 2 of 2 without is lost');
  assert.equal(status(five(site('a', runs(2, 0, 150), runs(2, 0, 100)))).sites[0].status, 'slower', 'dropped site with both loads good is judged on its ratio, not excluded');
  const both = status(five(site('a', runs(2, 2, 100), runs(2, 2, 100))));
  assert.equal(both.sites[0].status, 'excluded', 'a site dropped after 2 rounds with no good load on either side is excluded');
  assert.equal(both.pass, true, 'one excluded site next to 4 passes is not a loss');
  const withOk = status(five(site('a', runs(2, 0, 100), runs(2, 2, 100))));
  assert.match(withOk.sites[0].result, /^excluded \(without: 0 of 2 loads worked/, 'only the unusable side is named');
  assert.equal(judge([site('a', runs(1, 0, 100), runs(1, 0, 100))], 1).pass, true, 'SITE_RUNS=1 smoke: one good load is enough, 1 site needs 1');
  assert.equal(judge([site('a', runs(1, 1, 100), runs(1, 0, 100))], 1).sites[0].status, 'lost', 'SITE_RUNS=1: losing the only load is a loss');
  assert.equal(judge([site('a', [{ ok: true, load: 100, dcl: 1, heapMb: NaN }, ...runs(4, 0, 100)], runs(5, 0, 100))], 5).sites[0].status, 'pass', 'a missing heap reading does not drop a timing');
  console.log('self-check ok');
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  try {
    readEnv();
  } catch (e) {
    console.log(`\nFAIL: ${e.message}`);
    process.exit(1);
  }
  const hard = setTimeout(async () => {
    stopped = true;
    console.error(`FAIL: the run took more than ${TOTAL_MS / 1000} s and was stopped`);
    await closeAll();
    process.exit(1);
  }, TOTAL_MS);
  const server = http.createServer((req, res) => {
    const cards = Array.from({ length: 300 }, (_, i) => `<div class="card c${i % 7}"><h3>Item ${i}</h3><p>Plain text for item ${i}, with a <a href="#${i}">link</a>.</p></div>`).join('');
    res.setHeader('content-type', 'text/html');
    res.setHeader('cache-control', 'no-store');
    res.end(`<!doctype html><title>Plain page</title><style>.card{margin:4px;padding:4px}</style><h1>Plain page</h1>${cards}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const LOCAL_URL = `http://127.0.0.1:${server.address().port}/`;

  let exitCode = 1;
  try {
    if (!LOCAL_RUNS && !(SITE_RUNS && SITES.length)) throw setupError('nothing to measure: LOCAL_RUNS is 0 and there are no sites or SITE_RUNS is 0');
    if (!existsSync(join(EXT, 'manifest.json'))) throw setupError(`there is no built extension; ${BUILD_HINT}`);
    const a = await launchSide('with the extension', true);
    const b = await launchSide('without the extension', false);
    console.log(`Extension ${a.info}`);
    await load(a, LOCAL_URL, false);
    await load(b, LOCAL_URL, false);

    const verdicts = [];
    if (LOCAL_RUNS) {
      for (let i = 0; i < LOCAL_RUNS; i++) await round(a, b, i, LOCAL_URL, false);
      verdicts.push(localPart(a, b));
    }
    if (SITE_RUNS && SITES.length) {
      const rows = [];
      for (const [n, url] of SITES.entries()) {
        const u = new URL(url);
        const label = u.host + (u.pathname === '/' ? '' : u.pathname);
        a.runs = [];
        b.runs = [];
        for (let i = 0; i < SITE_RUNS; i++) {
          await round(a, b, n + i, url, true);
          const show = (s) => { const r = s.runs.at(-1); return r.ok ? `${r.load.toFixed(0)} ms` : r.why; };
          console.error(`${label} ${i + 1}/${SITE_RUNS}: with ${show(a)}, without ${show(b)}`);
          if (i === 1 && (!ok(a.runs).length || !ok(b.runs).length)) break;
        }
        rows.push({ label, w: a.runs, wo: b.runs });
      }
      verdicts.push(sitesPart(rows));
    }
    console.log('');
    for (const v of verdicts) console.log(v.line);
    const pass = verdicts.every((v) => v.pass);
    const hint = verdicts.map((v) => v.hint).filter(Boolean).join('; ');
    console.log(pass ? '\nPASS' : `\nFAIL${hint ? `: ${hint}` : ''}`);
    exitCode = pass ? 0 : 1;
  } catch (e) {
    console.log(`\nFAIL: ${e.setup ? e.message : (e.stack ?? e)}`);
  } finally {
    clearTimeout(hard);
    await closeAll();
    server.close();
  }
  process.exit(exitCode);
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) await main();
