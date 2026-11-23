// Phase 3 gate: node test/dl-perf.mjs [--only scripts,rest,idle,start,pages] [--self-check]. Hold chrome-live first; a row that cannot be measured FAILS.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launch, startWorker, stopWorker } from './harness.mjs';
import { startFixture } from './dl/_fixture.mjs';
import { engineCount, extPage, readRecords, resetDl, sendMsg, until } from './dl/_helpers.mjs';

const APP = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(APP, 'dist');
const BASE = process.env.DLPERF_BASE ?? '47c7ea4';
const BASE_DIST = process.env.DLPERF_BASE_DIST;
const env = (key, fallback) => {
  const n = process.env[key] === undefined ? fallback : Number(process.env[key]);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
};
const START_LIMIT_MS = env('DLPERF_START_LIMIT_MS', 300);
const IDLE_LIMIT_S = env('DLPERF_IDLE_LIMIT_S', 75);
const DCL_LIMIT_MS = env('DLPERF_DCL_LIMIT_MS', 20);
const START_RUNS = env('DLPERF_START_RUNS', 5);
const LOCAL_RUNS = 20;
const TOTAL_MS = 15 * 60_000;
const PARTS = ['scripts', 'rest', 'idle', 'start', 'pages'];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const row = (check, measured, limit, pass, note = '') => ({ check, measured, limit, pass: pass === true, note });
const atMost = (check, measured, limit, note) => row(check, Number.isFinite(measured) ? String(Math.round(measured * 10) / 10) : 'n/a', `<= ${limit}`, Number.isFinite(measured) && measured <= limit, note);
const unmeasured = (check, why) => row(check, 'n/a', '', false, `could not measure: ${why}`);
const samplesOk = (values, want) => Array.isArray(values) && values.length === want && values.every(Number.isFinite);
export function parseLocalPage(text) {
  const diff = /Local page: median DCL ([+-]?\d+(?:\.\d+)?) ms with the extension/.exec(text);
  const loads = [...text.matchAll(/^\| (with|without) the extension \| (\d+)\/(\d+) \|/gm)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  if (!diff || loads.length !== 2) return null;
  return { diff: Number(diff[1]), loads };
}

function selfCheck() {
  assert.equal(atMost('x', 300, 300).pass, true, 'the limit itself passes');
  assert.equal(atMost('x', 300.1, 300).pass, false, 'over the limit fails');
  assert.equal(atMost('x', NaN, 300).pass, false, 'NaN fails');
  assert.equal(atMost('x', undefined, 300).pass, false, 'undefined fails');
  assert.equal(atMost('x', Infinity, 300).pass, false, 'Infinity fails');
  assert.equal(atMost('x', null, 300).pass, false, 'null fails');
  assert.equal(unmeasured('x', 'why').pass, false, 'an unmeasured row fails');
  assert.equal(row('x', '1', '', 'yes').pass, false, 'only true passes');
  assert.equal(samplesOk([1, 2, 3, 4, 5], 5), true);
  assert.equal(samplesOk([1, 2, 3, 4], 5), false, 'four of five samples fail');
  assert.equal(samplesOk([1, 2, 3, 4, NaN], 5), false, 'a NaN sample fails');
  assert.equal(samplesOk([], 5), false, 'zero samples fail');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const good = '| with the extension | 20/20 | 10.0 | 9 | 12 |\n| without the extension | 20/20 | 9.0 | 8 | 11 |\nLocal page: median DCL +1.0 ms with the extension (limit +20 ms): PASS';
  assert.deepEqual(parseLocalPage(good), { diff: 1, loads: [['with', 20, 20], ['without', 20, 20]] });
  assert.equal(parseLocalPage(good.replace('+1.0', '-3.5')).diff, -3.5, 'a negative difference parses');
  assert.equal(parseLocalPage('Local page: FAIL, no load worked'), null, 'no figure is no measurement');
  assert.equal(parseLocalPage(good.split('\n').slice(2).join('\n')), null, 'a figure without the load counts is no measurement');
  console.log('self-check ok');
}

const repoRoot = () => execFileSync('git', ['-C', APP, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function buildBase() {
  if (BASE_DIST) return BASE_DIST;
  const root = repoRoot();
  const dir = mkdtempSync(join(tmpdir(), 'sieve-dl-perf-base-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  execFileSync('sh', ['-c', 'git -C "$1" archive "$2" apps/sieve packages/sieve-core packages/ui packages/config | tar -x -C "$3"', 'sh', root, BASE, dir]);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  for (const p of ['apps/sieve/node_modules', 'packages/sieve-core/node_modules']) cpSync(join(root, p), join(dir, p), { recursive: true, verbatimSymlinks: true });
  cpSync(join(root, 'apps/sieve/filters/cache'), join(dir, 'apps/sieve/filters/cache'), { recursive: true });
  execFileSync('node', ['build.mjs'], { cwd: join(dir, 'apps/sieve'), stdio: 'pipe', timeout: 180_000 });
  return join(dir, 'apps/sieve/dist');
}

// A later --load-extension replaces the harness's own (Chrome keeps the last value of a repeated switch).
async function open(dist) {
  const gone = new Promise((_, reject) => setTimeout(() => reject(new Error('no extension service worker within 60 s')), 60_000).unref());
  const { ctx, sw, id } = await Promise.race([launch(dist ? { extraArgs: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] } : {}), gone]);
  for (let i = 0; ; i++) {
    const s = await sw.evaluate(async () => ({ rulesets: (await chrome.declarativeNetRequest.getEnabledRulesets()).length, scripts: (await chrome.scripting.getRegisteredContentScripts()).length })).catch(() => ({}));
    if (s.rulesets && s.scripts) break;
    if (i >= 150) throw new Error(`the extension did not finish setting up within 15 s (${JSON.stringify(s)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ctx, sw, id, errors: [] };
}

async function partScripts(t) {
  const base = JSON.parse(execFileSync('git', ['-C', APP, 'show', `${BASE}:apps/sieve/src/manifest.json`], { encoding: 'utf8' })).content_scripts;
  const mine = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')).content_scripts;
  const ids = await t.sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const dl = ids.filter((id) => id.startsWith('dl'));
  return [
    Array.isArray(base) && base.length > 0 && Array.isArray(mine)
      ? row(`dist content_scripts equal Phase 1 (${BASE})`, `${mine.length} script(s)`, `deep-equal to ${base.length}`, isDeepStrictEqual(mine, base))
      : unmeasured('dist content_scripts equal Phase 1', `base has ${JSON.stringify(base)?.slice(0, 40)}, dist has ${JSON.stringify(mine)?.slice(0, 40)}`),
    ids.length > 0 ? atMost(`registered script ids starting "dl" (of ${ids.length})`, dl.length, 0, dl.join(', ')) : unmeasured('registered script ids starting "dl"', 'no registered scripts were listed'),
  ];
}

async function partRest(t) {
  await new Promise((r) => setTimeout(r, 3000));
  const fresh = await engineCount(t);
  await resetDl(t);
  const status = await stopWorker(t.ctx);
  const first = atMost('offscreen documents after a browser start, no record', fresh, 0);
  if (status !== 'stopped') return [first, unmeasured('offscreen documents 3 s after a worker restart, no record', `the worker did not stop (${status})`)];
  await startWorker(t.ctx, t.id);
  await new Promise((r) => setTimeout(r, 3000));
  return [first, atMost('offscreen documents 3 s after a worker restart, no record', await engineCount(t), 0)];
}

async function partIdle(t, fx) {
  await resetDl(t);
  fx.reset();
  const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', url: `${fx.base}/file/5000000/idle.bin` }] });
  if (!reply?.ok) throw new Error(`dl-add failed: ${JSON.stringify(reply)}`);
  const rec = await until(async () => {
    const r = (await readRecords(t)).find((x) => x.id === reply.ids[0]);
    if (r?.state === 'failed') throw new Error(`the 5 MB download failed: ${r.error}`);
    return r?.state === 'done' ? r : null;
  }, 60_000).catch((e) => {
    throw new Error(`the 5 MB download did not finish: ${e.message}`);
  });
  const docs = await engineCount(t);
  if (docs < 1) throw new Error('no offscreen document was open when the record was done, so nothing was shown to close');
  const at = Date.now();
  let gone = NaN;
  while (Date.now() - at < (IDLE_LIMIT_S + 10) * 1000) {
    if ((await engineCount(t)) === 0) {
      gone = (Date.now() - at) / 1000;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return atMost('seconds from a finished 5 MB download to no offscreen document', gone, IDLE_LIMIT_S, `documents open when the record was done: ${docs}; record ${rec.id}${Number.isFinite(gone) ? '' : '; still open after the wait'}`);
}

async function partStart(t, baseDist) {
  const b = await open(baseDist);
  const pages = new Map([[t, await extPage(t, 'devtools.html')], [b, await extPage(b, 'devtools.html')]]);
  const manifest = await pages.get(b).evaluate(() => chrome.runtime.getManifest());
  if (manifest.permissions.includes('offscreen') || manifest.permissions.includes('downloads')) throw new Error(`the base build is not Phase 1's (permissions ${manifest.permissions.join(',')})`);
  await resetDl(t);
  const timed = (x, msg, want) =>
    pages.get(x).evaluate(async ([m, w]) => {
      const t0 = performance.now();
      const reply = await chrome.runtime.sendMessage(m).catch((e) => ({ error: String(e.message) }));
      return { ms: performance.now() - t0, ok: JSON.stringify(reply) === JSON.stringify(w), reply };
    }, [msg, want]);
  const cold = async (x, msg, want) => {
    await x.sw.evaluate(() => chrome.offscreen?.closeDocument().catch(() => {}));
    const status = await stopWorker(x.ctx);
    if (status !== 'stopped') throw new Error(`the worker did not stop (${status})`);
    const r = await timed(x, msg, want);
    if (!r.ok) throw new Error(`unexpected reply ${JSON.stringify(r.reply)} to ${msg.type}`);
    return r.ms;
  };
  const pick = [{ type: 'pick' }, { ok: false }];
  const dlDo = [{ type: 'dl-do', op: 'pause', ids: [] }, { ok: true }];
  const s = { base: [], pick: [], dl: [] };
  for (let i = -1; i < START_RUNS; i++) {
    const a = await cold(b, ...pick);
    const c = await cold(t, ...pick);
    const d = await cold(t, ...dlDo);
    if (i >= 0) (s.base.push(a), s.pick.push(c), s.dl.push(d));
  }
  await b.ctx.close();
  const fmt = (v) => v.map((x) => Math.round(x)).join('/');
  const med = (v) => (samplesOk(v, START_RUNS) ? median(v) : NaN);
  const note = `ms over ${START_RUNS} cold starts each (one untimed round first): Phase 1 ${fmt(s.base)} (median ${Math.round(med(s.base))}); Phase 3 pick ${fmt(s.pick)} (${Math.round(med(s.pick))}); Phase 3 dl-do ${fmt(s.dl)} (${Math.round(med(s.dl))}); base build ${baseDist}`;
  return [
    atMost('worker cold start to first dl-do reply, Phase 3 minus Phase 1 (median ms)', med(s.dl) - med(s.base), START_LIMIT_MS, note),
    atMost('worker cold start to first pick reply, Phase 3 minus Phase 1 (median ms; same message)', med(s.pick) - med(s.base), START_LIMIT_MS),
  ];
}

let child = null;

function partPages() {
  return new Promise((resolve) => {
    const opts = { cwd: APP, timeout: 10 * 60_000, maxBuffer: 1 << 24, env: { ...process.env, LOCAL_RUNS: String(LOCAL_RUNS), SITE_RUNS: '0' } };
    child = execFile('node', ['test/perf.mjs'], opts, (error, stdout, stderr) => {
      const text = `${stdout}\n${stderr}`;
      const m = parseLocalPage(text);
      if (!m) return resolve([unmeasured('local page DCL with the extension minus without (median ms)', `perf.mjs gave no figure (${error ? String(error.message).split('\n')[0] : 'exit 0'}): ${text.trim().slice(-300)}`)]);
      console.log(`\nperf.mjs, local page only:\n${text.split('\n').filter((l) => /^(\||###|Local page|Extension)/.test(l)).join('\n')}`);
      const short = m.loads.some(([, ok, n]) => ok !== LOCAL_RUNS || n !== LOCAL_RUNS);
      resolve([atMost(`local page DCL with the extension minus without, ${LOCAL_RUNS} loads each (median ms)`, short ? NaN : m.diff, DCL_LIMIT_MS, short ? `loads that worked: ${JSON.stringify(m.loads)}` : '')]);
    });
  });
}

async function main() {
  if (process.argv.includes('--self-check')) return selfCheck();
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
  if (only && !only.every((p) => PARTS.includes(p))) throw new Error(`--only takes ${PARTS.join(', ')}`);
  const want = (p) => !only || only.includes(p);
  const rows = [];
  let a;
  let fx;
  const hard = setTimeout(() => {
    console.log(`\nFAIL: the run took more than ${TOTAL_MS / 60_000} minutes and was stopped`);
    child?.kill('SIGKILL');
    process.exit(1);
  }, TOTAL_MS);
  const step = async (part, label, fn) => {
    if (!want(part)) return;
    try {
      rows.push(...[await fn()].flat());
    } catch (e) {
      rows.push(unmeasured(label, String(e?.message ?? e).split('\n').slice(0, 3).join(' | ')));
    }
  };
  try {
    if (!existsSync(join(DIST, 'manifest.json'))) throw new Error(`there is no built extension; run \`pnpm --filter sieve build\` (${DIST})`);
    const browserParts = ['scripts', 'rest', 'idle', 'start'].filter(want);
    if (browserParts.length) a = await open().catch((e) => void rows.push(unmeasured('browser with dist/ starts', e.message)));
    if (a) {
      await step('scripts', 'content scripts', () => partScripts(a));
      await step('rest', 'engine at rest', () => partRest(a));
      if (want('idle')) fx = await startFixture();
      await step('idle', 'idle close after a download', () => partIdle(a, fx));
      await step('start', 'worker start', async () => partStart(a, buildBase()));
    } else {
      for (const p of browserParts) rows.push(unmeasured(`part ${p}`, 'no browser'));
    }
    await a?.ctx.close().catch(() => {});
    a = null;
    await step('pages', 'ordinary pages', partPages);
  } catch (e) {
    rows.push(unmeasured('setup', String(e?.message ?? e)));
  } finally {
    clearTimeout(hard);
    await fx?.close?.().catch(() => {});
    await a?.ctx.close().catch(() => {});
  }
  console.log('\n| check | measured | limit | result |\n| --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${r.check} | ${r.measured} | ${r.limit} | ${r.pass ? 'PASS' : 'FAIL'} |`);
  for (const r of rows.filter((x) => x.note)) console.log(`\n${r.check}: ${r.note}`);
  const pass = rows.length > 0 && rows.every((r) => r.pass);
  console.log(`\n${pass ? (only ? 'PARTIAL: the selected parts passed; this is not the gate' : 'PASS') : 'FAIL'}`);
  process.exit(pass ? (only ? 3 : 0) : 1);
}

await main().catch((e) => {
  console.log(`\nFAIL: ${e?.stack ?? e}`);
  process.exit(1);
});
