// Anti-goal 1, browsing does not slow down: with dist/ against no extension in fresh profiles, local DCL at most +20 ms and cold load within 1.10x on 4 of 5 real sites.
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT = fileURLToPath(new URL('../dist', import.meta.url));

const num = (key, fallback) => {
  const v = process.env[key];
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a number of 0 or more, got "${v}"`);
  return n;
};
const LOCAL_RUNS = num('LOCAL_RUNS', 20);
const SITE_RUNS = num('SITE_RUNS', 5);
const LOAD_MS = num('LOAD_TIMEOUT_MS', 60_000);
const TOTAL_MS = num('TOTAL_TIMEOUT_MS', 30 * 60_000);
const SETTLE_MS = num('SETTLE_MS', 1000);
const SITES = process.env.SITES !== undefined
  ? process.env.SITES.split(',').map((s) => s.trim()).filter(Boolean)
  : ['https://www.theguardian.com/', 'https://www.dawn.com/', 'https://edition.cnn.com/', 'https://www.weather.com/', 'https://www.bbc.com/news'];
const DCL_LIMIT_MS = 20;
const LOAD_RATIO = 1.1;
const NEED_SITES = Math.ceil(0.8 * SITES.length);
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
const med = (runs, key) => median(ok(runs).map((r) => r[key]));
const reasons = (runs) => [...new Set(runs.filter((r) => !r.ok).map((r) => r.why))].join('; ');

const sides = [];
const closeAll = () => within(Promise.allSettled(sides.map((s) => s.ctx.close())), 10_000).catch(() => {});

async function launchSide(name, withExtension) {
  const profile = mkdtempSync(join(tmpdir(), 'sieve-perf-'));
  process.on('exit', () => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  });
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROMIUM,
    headless: process.env.HEADLESS !== '0',
    args: withExtension ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [],
  });
  const side = { name, ctx, runs: [], info: '' };
  sides.push(side);
  if (withExtension) {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30_000 });
    let state;
    for (let i = 0; ; i++) {
      state = await sw.evaluate(async () => ({ rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(), scripts: (await chrome.scripting.getRegisteredContentScripts()).length }));
      if (state.rulesets.length && state.scripts) break;
      if (i >= 150) throw new Error(`the extension did not finish setting up within 15 s (${JSON.stringify(state)}); run \`pnpm --filter sieve build\``);
      await sleep(100);
    }
    side.info = `${new URL(sw.url()).host}: rulesets ${state.rulesets.join(', ')}; ${state.scripts} registered content scripts`;
  } else if (ctx.serviceWorkers().length) {
    throw new Error('the profile meant to run without the extension has a service worker');
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
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  return { ok: true, ...t, heapMb: metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576 };
}

async function load(side, url, real) {
  const page = await side.ctx.newPage();
  try {
    return await within(measure(page, url, real), LOAD_MS + 30_000);
  } catch (e) {
    return { ok: false, why: String(e.message).split('\n')[0].replace(/^page\.goto: /, '').replace(/ at https?:\/\/\S+$/, '').slice(0, 90) };
  } finally {
    await within(page.close(), 5000).catch(() => {});
  }
}

async function round(a, b, i, url, real) {
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

function sitesPart(rows) {
  console.log(`\n### Real sites (${SITE_RUNS} cold loads per profile, medians)\n`);
  console.log('| site | with: DCL ms | with: load ms | with: heap MB | without: DCL ms | without: load ms | without: heap MB | load ratio | loads ok (with, without) | result |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const cell = (runs) => (ok(runs).length ? `${med(runs, 'dcl').toFixed(0)} | ${med(runs, 'load').toFixed(0)} | ${med(runs, 'heapMb').toFixed(1)}` : 'failed | failed | failed');
  const notes = [];
  let passed = 0;
  for (const { label, w, wo } of rows) {
    const bad = [['with', w], ['without', wo]].filter(([, runs]) => !ok(runs).length);
    let ratio = '';
    let result;
    if (bad.length) {
      result = `excluded (${bad.map(([n, runs]) => `${n}: ${reasons(runs)}`).join('; ')})`;
      if (bad.length === 1) notes.push(`${label} failed only ${bad[0][0]} the extension: check by hand that the extension did not break it.`);
    } else {
      const r = med(w, 'load') / med(wo, 'load');
      ratio = `${r.toFixed(2)}x`;
      result = r <= LOAD_RATIO ? 'pass' : 'slower';
      if (r <= LOAD_RATIO) passed++;
      if (reasons(w) || reasons(wo)) notes.push(`${label}: some loads failed (with: ${reasons(w) || 'none'}; without: ${reasons(wo) || 'none'}); the medians use the loads that worked.`);
    }
    console.log(`| ${label} | ${cell(w)} | ${cell(wo)} | ${ratio} | ${ok(w).length}/${w.length}, ${ok(wo).length}/${wo.length} | ${result} |`);
  }
  for (const n of notes) console.log(`\n${n}`);
  const excluded = rows.filter((r) => !ok(r.w).length || !ok(r.wo).length).length;
  const pass = passed >= NEED_SITES;
  return { pass, line: `Real sites: ${passed} of ${SITES.length} within ${LOAD_RATIO.toFixed(2)}x load time (need ${NEED_SITES}${excluded ? `; ${excluded} excluded because a load failed, so they cannot count as a pass` : ''}): ${pass ? 'PASS' : 'FAIL'}` };
}

const hard = setTimeout(async () => {
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
  if (!LOCAL_RUNS && !(SITE_RUNS && SITES.length)) throw new Error('nothing to measure: LOCAL_RUNS is 0 and there are no sites or SITE_RUNS is 0');
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
  console.log(pass ? '\nPASS' : '\nFAIL');
  exitCode = pass ? 0 : 1;
} catch (e) {
  console.log(`\nFAIL: ${e.stack ?? e}`);
} finally {
  clearTimeout(hard);
  await closeAll();
  server.close();
}
process.exit(exitCode);
