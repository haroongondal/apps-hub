// Task 2.19: leaks and settings read cost on the local fixture, then live watch-page load. `node test/yt-perf.mjs [--local|--live|--self-check]`, build first, machine to itself.
// Flicker (row never removed, never 0 px tall) is not repeated: row.mjs checks it locally and live. A bot-check or consent page excludes a side, it never passes it.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const LIMIT = { listeners: 5, nodes: 20, heapBytes: 1048576, readMs: 20, loadRatio: 1.1, liveHeapMb: 5 };
const EPS = 1e-9;
const CYCLES = 25;
const READ_RUNS = 10;
const MY_FILTERS_BYTES = 2 * 1024 * 1024;
const LIVE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const HEAP_WAIT_MS = 10_000;
const ARGS = ['--autoplay-policy=no-user-gesture-required'];
const CORE = new URL('../../../packages/sieve-core/src/', import.meta.url).href;

export const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : 'n/a');
const sign = (n, digits = 1) => `${n >= 0 ? '+' : ''}${fmt(n, digits)}`;

export function judgeLeaks(before, after) {
  const rows = [['JSEventListeners', LIMIT.listeners], ['Nodes', LIMIT.nodes], ['JSHeapUsedSize', LIMIT.heapBytes]].map(([metric, limit]) => {
    const grew = after?.[metric] - before?.[metric];
    return { metric, before: before?.[metric], after: after?.[metric], grew, limit, pass: Number.isFinite(grew) && grew <= limit + EPS };
  });
  return { pass: rows.every((r) => r.pass), rows };
}

// Every one of the READ_RUNS loads on both sides must have the mark: `median` skips NaN, so a side with 1 of 10 marks would otherwise pass.
const full = (a) => a.length === READ_RUNS && a.every(Number.isFinite);
export function judgeRead(none, big) {
  const diff = median(big) - median(none);
  return { pass: full(none) && full(big) && Number.isFinite(diff) && diff <= LIMIT.readMs + EPS, diff, none: median(none), big: median(big), missing: !full(none) || !full(big) };
}

export function judgeLive(withSieve, without, planned) {
  // A load without Sieve in it measures nothing about Sieve, whatever the control lost.
  const notRun = withSieve.find((x) => x.notRun);
  if (notRun) return { status: 'fail', why: notRun.why };
  const good = (r) => r.filter((x) => x.ok);
  const hard = (r) => r.filter((x) => !x.ok && !x.gated).length;
  if (hard(withSieve) > hard(without)) {
    const first = withSieve.find((x) => !x.ok && !x.gated);
    return { status: 'fail', why: `${hard(withSieve)} loads with Sieve failed against ${hard(without)} without (${first.why})` };
  }
  const min = Math.max(1, Math.ceil(Math.min(planned, withSieve.length, without.length) / 2));
  const usable = [good(withSieve).length >= min, good(without).length >= min];
  if (!usable[0] || !usable[1]) {
    const side = (name, r, u) => (u ? null : `${name}: ${good(r).length} of ${r.length} loads worked${r.find((x) => !x.ok)?.why ? `, ${r.find((x) => !x.ok).why}` : ''}`);
    const why = [side('with Sieve', withSieve, usable[0]), side('without', without, usable[1])].filter(Boolean).join('; ');
    return { status: 'excluded', why };
  }
  const ratio = median(good(withSieve).map((r) => r.load)) / median(good(without).map((r) => r.load));
  const heapDiff = median(good(withSieve).map((r) => r.heapMb)) - median(good(without).map((r) => r.heapMb));
  if (!Number.isFinite(ratio) || !Number.isFinite(heapDiff)) return { status: 'excluded', why: 'no heap reading on one side', ratio, heapDiff };
  const slow = ratio > LIMIT.loadRatio + EPS;
  const big = heapDiff > LIMIT.liveHeapMb + EPS;
  const why = [slow && `load ${ratio.toFixed(2)}x (limit ${LIMIT.loadRatio.toFixed(2)}x)`, big && `heap ${sign(heapDiff)} MB (limit +${LIMIT.liveHeapMb} MB)`].filter(Boolean).join(', ');
  return { status: slow || big ? 'fail' : 'pass', ratio, heapDiff, why };
}

export function verdict({ leaks, read, live }) {
  const failed = [leaks && !leaks.pass, read && !read.pass, ...(live ?? []).map((l) => l.status === 'fail')].some(Boolean);
  if (failed) return 1;
  return (live ?? []).some((l) => l.status === 'excluded') ? 2 : 0;
}

function selfCheck() {
  const m = (listeners, nodes, heap) => ({ JSEventListeners: listeners, Nodes: nodes, JSHeapUsedSize: heap });
  assert.equal(judgeLeaks(m(100, 1000, 5e6), m(105, 1020, 5e6 + 1048576)).pass, true, 'leaks: growth exactly at 5 listeners, 20 nodes and 1 MB passes');
  assert.equal(judgeLeaks(m(100, 1000, 5e6), m(106, 1000, 5e6)).pass, false, 'leaks: 6 listeners fails');
  assert.equal(judgeLeaks(m(100, 1000, 5e6), m(100, 1021, 5e6)).pass, false, 'leaks: 21 nodes fails');
  assert.equal(judgeLeaks(m(100, 1000, 5e6), m(100, 1000, 5e6 + 1048577)).pass, false, 'leaks: 1 MB and 1 byte fails');
  assert.equal(judgeLeaks(m(100, 1000, 5e6), m(90, 900, 4e6)).pass, true, 'leaks: shrinking passes');
  assert.equal(judgeLeaks(m(100, 1000, 5e6), { JSEventListeners: 100, Nodes: 1000 }).pass, false, 'leaks: a missing metric is not a pass');
  assert.equal(judgeLeaks(null, null).pass, false, 'leaks: no readings is not a pass');

  const ten = (...v) => Array.from({ length: 10 }, (_, i) => v[i % v.length]);
  assert.equal(judgeRead(ten(10, 12, 11), ten(30, 32, 31)).pass, true, 'read: equal medians 11 and 31, exactly +20, pass');
  assert.equal(judgeRead(ten(10, 12, 11), ten(31, 33, 32)).pass, false, 'read: +21 fails');
  assert.equal(judgeRead([], ten(30)).pass, false, 'read: no reading without My filters is not a pass');
  assert.equal(judgeRead(ten(10), [NaN, ...ten(30).slice(1)]).pass, false, 'read: a missing mark with My filters is not a pass');
  assert.equal(judgeRead(ten(10), [30, ...Array(9).fill(NaN)]).pass, false, 'read: 1 of 10 marks with My filters is not a pass');
  assert.equal(judgeRead([10, ...Array(9).fill(NaN)], ten(30)).pass, false, 'read: 1 of 10 marks without My filters is not a pass');
  assert.equal(judgeRead(ten(10), ten(30).slice(1)).pass, false, 'read: 9 loads is not a pass');
  assert.equal(judgeRead([10, 10, 10, 10, 10, 12, 12, 12, 12, 12], [30, 30, 30, 30, 30, 36, 36, 36, 36, 36]).diff, 22, 'read: an even count takes the middle two (11 and 33)');

  const run = (load, heapMb = 100) => ({ ok: true, dcl: 100, load, heapMb });
  const runs = (n, load, heapMb) => Array.from({ length: n }, () => run(load, heapMb));
  const bot = (n) => Array.from({ length: n }, () => ({ ok: false, gated: true, why: 'bot check' }));
  const timeout = (n) => Array.from({ length: n }, () => ({ ok: false, gated: false, why: 'no answer after 60 s' }));
  assert.equal(judgeLive(runs(7, 110, 105), runs(7, 100, 100), 7).status, 'pass', 'live: load exactly 1.10x and heap exactly +5 MB pass');
  assert.equal(judgeLive(runs(7, 111, 100), runs(7, 100, 100), 7).status, 'fail', 'live: load 1.11x fails');
  assert.equal(judgeLive(runs(7, 100, 105.1), runs(7, 100, 100), 7).status, 'fail', 'live: heap +5.1 MB fails');
  assert.equal(judgeLive(runs(7, 90, 90), runs(7, 100, 100), 7).status, 'pass', 'live: faster and smaller passes');
  assert.match(judgeLive(runs(7, 120, 110), runs(7, 100, 100), 7).why, /load 1\.20x .*heap \+10\.0 MB/, 'live: a double failure names both');
  assert.equal(judgeLive(bot(7), runs(7, 100), 7).status, 'excluded', 'live: a bot-check side is excluded, not passed');
  assert.equal(judgeLive(runs(7, 100), bot(7), 7).status, 'excluded', 'live: a bot-check control is excluded too');
  assert.equal(judgeLive(bot(2), runs(2, 100), 2).status, 'excluded', 'live: a side dropped after 2 gated rounds is excluded');
  assert.equal(judgeLive([...runs(3, 100), ...bot(4)], runs(7, 100), 7).status, 'excluded', 'live: 3 of 7 good loads is under the half needed');
  assert.equal(judgeLive([...runs(4, 100), ...bot(3)], runs(7, 100), 7).status, 'pass', 'live: 4 of 7 good loads is enough');
  assert.equal(judgeLive([], runs(7, 100), 7).status, 'excluded', 'live: a missing side is not a pass');
  assert.equal(judgeLive(runs(7, 100), [], 0).status, 'excluded', 'live: a missing control is not a pass');
  assert.equal(judgeLive([], [], 7).status, 'excluded', 'live: no runs at all is not a pass');
  assert.equal(judgeLive(timeout(7), runs(7, 100), 7).status, 'fail', 'live: timeouts with Sieve where the control loaded are a failure');
  assert.equal(judgeLive([...runs(4, 100), ...timeout(3)], runs(7, 100), 7).status, 'fail', 'live: 4 good loads and 3 timeouts with Sieve against 7 good is a failure, not a pass');
  assert.equal(judgeLive([...runs(4, 100), ...timeout(3)], [...runs(4, 100), ...timeout(3)], 7).status, 'pass', 'live: the same timeouts on both sides are not blamed on Sieve');
  assert.equal(judgeLive([...runs(6, 100), ...timeout(1)], runs(7, 100), 7).status, 'fail', 'live: one lost load with Sieve that the control kept is a failure');
  assert.equal(judgeLive(timeout(7), timeout(7), 7).status, 'excluded', 'live: timeouts on both sides say nothing about Sieve');
  assert.equal(judgeLive(runs(7, 100, NaN), runs(7, 100, 100), 7).status, 'excluded', 'live: a missing heap reading is not a pass');
  const notRun = (n) => Array.from({ length: n }, () => ({ ok: false, gated: false, notRun: true, why: 'Sieve did not run (0 sieve-yt-applied marks, row missing)' }));
  assert.equal(judgeLive([...runs(6, 100), ...notRun(1)], [...runs(6, 100), ...timeout(1)], 7).status, 'fail', 'live: a load where Sieve did not run fails, even when the control lost as many loads');
  assert.match(judgeLive([...runs(6, 100), ...notRun(1)], runs(7, 100), 7).why, /Sieve did not run/, 'live: the failure says Sieve did not run');

  const pass = { pass: true };
  assert.equal(verdict({ leaks: pass, read: pass, live: [{ status: 'pass' }, { status: 'pass' }] }), 0, 'verdict: all pass is 0');
  assert.equal(verdict({ leaks: pass, read: pass, live: [{ status: 'pass' }, { status: 'excluded' }] }), 2, 'verdict: an excluded live pass is no evidence, 2');
  assert.equal(verdict({ leaks: pass, read: pass, live: [{ status: 'excluded' }, { status: 'fail' }] }), 1, 'verdict: a failure beats an exclusion');
  assert.equal(verdict({ leaks: { pass: false }, read: pass, live: [{ status: 'pass' }] }), 1, 'verdict: a leak fails the run');
  assert.equal(verdict({ leaks: pass, read: { pass: false } }), 1, 'verdict: a slow read fails the run');
  assert.equal(verdict({ leaks: pass, read: pass }), 0, 'verdict: a local-only run is judged on the local parts');
  console.log('self-check ok');
}

function everyOption(core) {
  const patch = {};
  const at = (path) => path.split('.').reduce((o, k) => o[k], core.DEFAULT_YOUTUBE);
  const put = (path, value) => {
    const keys = path.split('.');
    let o = patch;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys.at(-1)] = value;
  };
  for (const g of core.YOUTUBE_GROUPS) {
    for (const f of g.fields) {
      if (f.kind === 'switch') put(f.path, true);
      if (f.kind === 'select') put(f.path, [...f.options].reverse().find((o) => o.value !== at(f.path)).value);
    }
  }
  put('theme.css', 'ytd-masthead{opacity:.99}');
  put('experiments.overrides', 'sieve_perf_flag=true');
  put('volume.wheel', 'over-video'); // both wheels on the right button would clash, and validation would reset one
  for (const [k, v] of Object.entries({ blur: 1, brightness: 110, contrast: 110, grayscale: 10, hue: 10, invert: 10, saturate: 110, sepia: 10 })) put(`player.filters.${k}`, v);
  return patch;
}

const leaves = (o, path = '') => Object.entries(o).flatMap(([k, v]) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${path}${k}.`) : [[`${path}${k}`, v]]));

async function localParts(core, helpers, harness) {
  const servers = await harness.startServers();
  const { ctx, sw, id } = await harness.launch({ extraHosts: ['www.youtube-nocookie.com', 'm.youtube.com'], extraArgs: ARGS });
  const t = { ctx, sw, id, servers, check: harness.check, errors: [], shots: tmpdir(), base: `https://www.youtube.com:${servers.httpsPort}` };
  const out = {};
  try {
    await sleep(1000);
    const set = await helpers.setYouTube(t, everyOption(core));
    const defaults = new Map(leaves(core.DEFAULT_YOUTUBE));
    const changed = leaves(set).filter(([p, v]) => JSON.stringify(v) !== JSON.stringify(defaults.get(p)));
    console.log(`\nEvery option on: ${changed.length} of ${defaults.size} stored values differ from the defaults`);
    console.log(changed.map(([p, v]) => `${p}=${JSON.stringify(v)}`).join(', '));
    assert.ok(changed.length >= 35, `"every option on" changed only ${changed.length} stored values (at least 35 expected): a field list or validation change dropped some`);

    const page = await helpers.openYt(t, '/watch?v=sieveTest01');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    };
    const rowThere = !!(await helpers.until(() => page.locator('sieve-yt-row').count(), 5000));
    let before = null;
    for (let i = 1; i <= CYCLES; i++) {
      await helpers.navigate(page, helpers.FIXTURE_IDS[i % helpers.FIXTURE_IDS.length]);
      await sleep(150);
      if (i === 5) before = await metrics();
    }
    const after = await metrics();
    await page.close();
    out.leaks = judgeLeaks(before, after);
    out.leaks.pass &&= rowThere;
    console.log(`\n### Leaks (local fixture, every option on, ${CYCLES} navigations, metrics after a GC at navigation 5 and ${CYCLES})\n`);
    console.log('| metric | at 5 | at 25 | grew | limit | result |\n| --- | --- | --- | --- | --- | --- |');
    for (const r of out.leaks.rows) console.log(`| ${r.metric} | ${fmt(r.before, 0)} | ${fmt(r.after, 0)} | ${sign(r.grew, 0)} | ${r.metric === 'JSHeapUsedSize' ? '1 MB (1048576)' : `+${r.limit}`} | ${r.pass ? 'PASS' : 'FAIL'} |`);
    if (!rowThere) console.log('FAIL: the row never appeared, so the options were not measured');
    if (t.errors.length) {
      out.leaks.pass = false;
      console.log(`FAIL: ${t.errors.length} page errors on the fixture: ${[...new Set(t.errors)].slice(0, 5).join(' | ')}`);
    }

    const filters = [];
    for (let n = 0, bytes = 0; bytes < MY_FILTERS_BYTES; n++) {
      const line = `example${n}.com##.ad-banner-${n}`;
      filters.push(line);
      bytes += line.length + 1;
    }
    const mark = async () => {
      const p = await helpers.openYt(t, '/watch?v=sieveTest01');
      const ms = await p.evaluate(() => performance.getEntriesByName('sieve-yt-applied')[0]?.startTime ?? null).catch(() => null);
      await p.close();
      return ms === null ? NaN : ms;
    };
    const block = async () => {
      await mark();
      await mark();
      const r = [];
      for (let i = 0; i < READ_RUNS; i++) r.push(await mark());
      return r;
    };
    await sw.evaluate(() => chrome.storage.local.remove('youtube'));
    await sleep(500);
    const none = await block();
    await sw.evaluate((text) => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, myFilters: text } } })), filters.join('\n'));
    const stored = await sw.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings.blocking.myFilters.length));
    await sleep(3000);
    const big = await block();
    out.read = judgeRead(none, big);
    console.log(`\n### Settings read cost (local fixture, default options, ${READ_RUNS} loads each after 2 warm-up loads; ${(stored / 1048576).toFixed(2)} MB of My filters stored)\n`);
    console.log('| My filters | median mark ms | min | max |\n| --- | --- | --- | --- |');
    for (const [name, r] of [['none', none], ['2 MB', big]]) console.log(`| ${name} | ${fmt(median(r), 1)} | ${fmt(Math.min(...r), 1)} | ${fmt(Math.max(...r), 1)} |`);
    console.log(`\nSettings read: the mark is ${sign(out.read.diff)} ms later with 2 MB of My filters (limit +${LIMIT.readMs} ms): ${out.read.pass ? 'PASS' : out.read.missing ? 'FAIL (a load had no sieve-yt-applied mark)' : 'FAIL'}`);
  } finally {
    await ctx.close().catch(() => {});
    servers.http.close();
    servers.https.close();
  }
  return out;
}

const within = (p, ms) => {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer after ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(timer));
};

// One stuck step (a navigation, evaluate or CDP call) must be reported as a failed load, not hang the run, so the whole load has a limit.
const LOAD_LIMIT_MS = 120_000;
async function loadOnce(ctx, sieve) {
  let page;
  const body = async () => {
    page = await within(ctx.newPage(), 15_000);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.clearBrowserCookies');
    await cdp.send('Storage.clearDataForOrigin', { origin: 'https://www.youtube.com', storageTypes: 'all' });
    await page.goto(LIVE_URL, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => /confirm you.re not a bot/i.test(document.body?.innerText ?? '') || document.querySelector('#movie_player video'), null, { timeout: 15_000 }).catch(() => {});
    const gate = await page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') }));
    if (gate.bot || gate.consent) return { ok: false, gated: true, why: gate.bot ? 'bot check' : 'consent page' };
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd };
    });
    if (!(t.load > 0)) throw new Error('no load event time');
    await sleep(HEAP_WAIT_MS);
    // A with-Sieve load only counts when Sieve ran in it: the mark once, and the row.
    if (sieve) {
      const ran = await page.evaluate(() => ({ marks: performance.getEntriesByName('sieve-yt-applied').length, row: !!document.querySelector('sieve-yt-row') }));
      if (ran.marks !== 1 || !ran.row) return { ok: false, gated: false, notRun: true, why: `Sieve did not run (${ran.marks} sieve-yt-applied marks, row ${ran.row ? 'there' : 'missing'})` };
    }
    let heapMb = NaN;
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('Performance.enable');
      heapMb = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
    } catch {}
    if (!Number.isFinite(heapMb)) return { ok: false, gated: false, why: 'no heap reading' };
    return { ok: true, ...t, heapMb };
  };
  try {
    return await within(body(), LOAD_LIMIT_MS);
  } catch (e) {
    return { ok: false, gated: false, why: String(e.message).split('\n')[0].slice(0, 90) };
  } finally {
    if (page) await within(page.close(), 5000).catch(() => {});
  }
}

async function livePart(core, helpers, harness, runs) {
  const results = [];
  for (const [name, patch] of [['default options', null], ['every option on', everyOption(core)]]) {
    // Fresh browsers per pass: Chrome stops an idle extension worker after a few minutes, and Playwright's handle to it then fails.
    const a = await harness.launch({ mapHosts: false, extraArgs: ARGS });
    const b = await harness.launch({ mapHosts: false, extension: false, extraArgs: ARGS });
    try {
      await sleep(1000);
      if (patch) await helpers.setYouTube({ sw: a.sw }, patch);
      await sleep(500);
      const w = [];
      const wo = [];
      for (let i = 0; i < runs; i++) {
        for (const [side, list] of i % 2 ? [[b, wo], [a, w]] : [[a, w], [b, wo]]) list.push(await loadOnce(side.ctx, side === a));
        const show = (r) => (r.ok ? `${r.load.toFixed(0)} ms, ${r.heapMb.toFixed(1)} MB` : r.why);
        console.error(`${name} ${i + 1}/${runs}: with Sieve ${show(w.at(-1))}, without ${show(wo.at(-1))}`);
        if (i === 1 && (!w.some((r) => r.ok) || !wo.some((r) => r.ok))) break;
      }
      results.push({ name, w, wo, ...judgeLive(w, wo, runs) });
    } finally {
      await within(Promise.all([a.ctx.close(), b.ctx.close()]), 15_000).catch(() => {});
    }
  }
  console.log(`\n### Watch page, live, signed out (${LIVE_URL}; ${runs} cold loads per side, alternating; medians of the loads that worked)\n`);
  console.log('| options | side | loads ok | median DCL ms | median load ms | median heap MB 10 s after load, after a GC |\n| --- | --- | --- | --- | --- | --- |');
  const cell = (r) => {
    const g = r.filter((x) => x.ok);
    return `${g.length}/${r.length} | ${fmt(median(g.map((x) => x.dcl)), 0)} | ${fmt(median(g.map((x) => x.load)), 0)} | ${fmt(median(g.map((x) => x.heapMb)))}`;
  };
  for (const r of results) console.log(`| ${r.name} | with Sieve | ${cell(r.w)} |\n| ${r.name} | without | ${cell(r.wo)} |`);
  console.log('');
  for (const r of results) {
    const body = r.status === 'excluded' ? `EXCLUDED, not passed (${r.why})` : `${r.ratio === undefined ? '' : `load ${r.ratio.toFixed(2)}x (limit ${LIMIT.loadRatio.toFixed(2)}x), heap ${sign(r.heapDiff)} MB (limit +${LIMIT.liveHeapMb} MB): `}${r.status === 'pass' ? 'PASS' : `FAIL${r.why ? ` (${r.why})` : ''}`}`;
    console.log(`Live, ${r.name}: ${body}`);
  }
  return results;
}

async function main() {
  const wantLocal = !process.argv.includes('--live');
  const wantLive = !process.argv.includes('--local');
  const runs = Number(process.env.LIVE_RUNS ?? 7);
  const hard = setTimeout(() => {
    console.error('FAIL: the run took more than 20 minutes and was stopped');
    process.exit(1);
  }, 20 * 60_000);
  let code = 1;
  try {
    const harness = await import('./harness.mjs');
    const helpers = await import('./yt/helpers.mjs');
    const core = await import(`${CORE}youtube-settings.ts`);
    const local = wantLocal ? await localParts(core, helpers, harness) : {};
    const live = wantLive ? await livePart(core, helpers, harness, runs) : undefined;
    code = verdict({ ...local, live });
    console.log(code === 0 ? '\nPASS' : code === 2 ? '\nNO EVIDENCE for a live pass (bot check or consent page, or no load worked): every part that ran passed' : '\nFAIL');
  } catch (e) {
    console.log(`\nFAIL: ${e?.stack ?? e}`);
  } finally {
    clearTimeout(hard);
  }
  process.exit(code);
}

if (process.argv.includes('--self-check')) selfCheck();
else if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main();
