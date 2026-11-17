import { createReadStream, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { engineCount, extPage, localGet, opfsNames, readRecords, resetDl, sendMsg, sessionGet, until } from './_helpers.mjs';

const CHECKPOINT = 4_194_304;
const MiB16 = 16_777_216;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (v) => String(JSON.stringify(v)).slice(0, 600);
const got = (r) => r.parts.reduce((n, p) => n + p.done, 0);

const BASE = Buffer.alloc(251 * 8192);
for (let i = 0; i < BASE.length; i++) BASE[i] = i % 251;

async function verifyFile(path, size) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return { size: -1, ok: false };
  }
  let off = 0;
  let ok = st.size === size;
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    const at = off % 251;
    if (Buffer.compare(chunk, BASE.subarray(at, at + chunk.length)) !== 0) {
      ok = false;
      break;
    }
    off += chunk.length;
  }
  return { size: st.size, ok };
}

const walk = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath ?? d.path, d.name).slice(dir.length + 1))
    .sort();

const ranges = (log, path, from = 0, to = log.length) =>
  log
    .slice(from, to)
    .filter((l) => l.path === path && !l.closed && l.range && l.range !== 'bytes=0-0')
    .map((l) => ({ start: Number(/^bytes=(\d+)-/.exec(l.range)[1]), t: l.t }));

const behindCheckpoint = (log, path, parts, from, to) =>
  ranges(log, path, from, to).filter((r) => {
    const p = parts.find((q) => r.start >= q.start && (q.end === null || r.start <= q.end));
    return p && r.start < p.start + p.done;
  });

const sentBytes = (log, path) => log.filter((l) => l.path === path && !l.closed).reduce((n, l) => n + (l.sent ?? 0), 0);

const HUB = (raw) => `chrome-extension://${raw.id}/options.html`;
const hubs = new WeakSet();
async function evalHub(raw, fn, arg) {
  if (!hubs.has(raw)) {
    await raw.openPage(HUB(raw));
    await until(() => raw.evalPage(HUB(raw), `typeof chrome.runtime?.id === 'string' && document.readyState === 'complete'`), 15000);
    hubs.add(raw);
  }
  return raw.evalPage(HUB(raw), `(${fn})(${JSON.stringify(arg ?? null)})`);
}
const rawRecords = (raw) =>
  evalHub(raw, async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'sieve-dl')) return [];
    const db = await new Promise((resolve, reject) => Object.assign(indexedDB.open('sieve-dl'), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
    try {
      if (!db.objectStoreNames.contains('records')) return [];
      return await new Promise((resolve, reject) => Object.assign(db.transaction('records').objectStore('records').getAll(), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
    } finally {
      db.close();
    }
  });
const rawSend = (raw, message) => evalHub(raw, (m) => chrome.runtime.sendMessage(m), message);
const rawEngines = (raw) => evalHub(raw, async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length);
const rawKeys = (raw, area) => evalHub(raw, async (a) => Object.keys(await chrome.storage[a].get(null)), area);
const rawOpfs = (raw) =>
  evalHub(raw, async () => {
    const out = [];
    for await (const [name] of (await navigator.storage.getDirectory()).entries()) out.push(name);
    return out;
  });

async function rawSetDownloads(raw, patch) {
  const cur = (await evalHub(raw, () => chrome.storage.local.get('downloads'))).downloads;
  const next = validateDownloadSettings({ ...validateDownloadSettings(cur), ...patch });
  await evalHub(raw, (v) => chrome.storage.local.set({ downloads: v }), next);
}
async function rawAdd(raw, url) {
  const reply = await rawSend(raw, { type: 'dl-add', items: [{ source: 'manual', url }] });
  if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
  return reply.ids[0];
}

async function waitRecord(raw, pred, ms = 60000, what = 'a record') {
  const end = Date.now() + ms;
  for (;;) {
    const all = await rawRecords(raw);
    const hit = all.find(pred);
    if (hit) return hit;
    const bad = all.find((r) => r.state === 'failed');
    if (bad) throw new Error(`${what}: the record failed (${bad.error})`);
    if (Date.now() > end) throw new Error(`${what}: timed out after ${ms} ms; records: ${json(all.map((r) => [r.state, got(r)]))}`);
    await sleep(250);
  }
}

export async function run(t) {
  if (!t.fx) return t.check('downloads: torture needs the fixture server', false);
  const { check, fx } = t;
  const name = (n) => `downloads: torture: ${n}`;
  const ranToEnd = (title, e) => check(name(`${title}: ran to the end`), false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
  let launchRaw;
  try {
    ({ launchRaw } = await import('./_raw-chrome.mjs'));
  } catch (e) {
    return check(name('_raw-chrome.mjs loads'), false, String(e?.message ?? e));
  }

  async function session(title, fn) {
    const profileDir = mkdtempSync(join(tmpdir(), 'sieve-torture-profile-'));
    const downloadsDir = mkdtempSync(join(tmpdir(), 'sieve-torture-downloads-'));
    let raw = null;
    const c = { downloadsDir, launch: async () => (raw = await launchRaw({ profileDir, downloadsDir })) };
    fx.reset();
    try {
      await fn(c);
    } catch (e) {
      ranToEnd(title, e);
    } finally {
      await Promise.resolve(raw?.kill('SIGKILL')).catch(() => {});
      await sleep(300);
      for (const d of [profileDir, downloadsDir]) rmSync(d, { recursive: true, force: true });
    }
  }
  const attempt = (title, fn) => fn().catch((e) => ranToEnd(title, e));

  const leftKeys = async (raw) => [...(await rawKeys(raw, 'local')).filter((k) => k.startsWith('dlTakeover:')), ...(await rawKeys(raw, 'session')).filter((k) => k.startsWith('dlSave:'))];
  async function nothingLeft(title, raw) {
    const ok = await until(async () => (await leftKeys(raw)).length === 0, 5000).catch(() => false);
    check(name(`${title}: no dlTakeover or dlSave key is left`), ok, json(ok ? [] : await leftKeys(raw)));
  }

  async function onlyFile(title, dir, rel, size) {
    const files = walk(dir);
    const v = await verifyFile(join(dir, rel), size);
    check(name(`${title}: the saved file has every byte right`), v.size === size && v.ok, json({ rel, v }));
    check(name(`${title}: exactly one file in Downloads and no .crdownload`), files.length === 1 && files[0] === rel, json(files));
  }

  await session('SIGKILL, one part', async (c) => {
    const title = 'SIGKILL, one part';
    const path = '/file/120000000/k.bin';
    const raw = await c.launch();
    const id = await rawAdd(raw, `${fx.base}${path}?rate=15000000`);
    let D = 0;
    let parts = [];
    for (const end = Date.now() + 60000; D <= 40_000_000; await sleep(500)) {
      const r = (await rawRecords(raw)).find((x) => x.id === id);
      if (r) [D, parts] = [got(r), r.parts];
      if (Date.now() > end) throw new Error(`the record never passed 40 MB (done ${D})`);
    }
    await raw.kill('SIGKILL');
    const mark = fx.log.length;
    const t0 = Date.now();
    const raw2 = await c.launch();
    const r = await waitRecord(raw2, (x) => x.id === id && x.state === 'done', 60000, title);
    const first = ranges(fx.log, path, mark)[0];
    const total = sentBytes(fx.log, path);
    check(name(`${title}: the first request after the relaunch resumes at N > 0 and N >= the last saved offset`), first && first.start > 0 && first.start >= D, json({ first, D }));
    check(name(`${title}: no request starts behind the saved offset`), behindCheckpoint(fx.log, path, parts, mark, fx.log.length).length === 0, json(parts));
    check(name(`${title}: the fixture sent at most the size plus 16 MiB`), total <= 120_000_000 + MiB16, `sent ${total}: ${json(fx.log.filter((l) => l.path === path).map((l) => [l.range, l.status, l.closed ? l.sent : null]))}`);
    await onlyFile(title, c.downloadsDir, 'Other/k.bin', 120_000_000);
    check(name(`${title}: the record is done with its saved path`), r.state === 'done' && !!r.savedPath, json(r.savedPath));
    const opfs = await rawOpfs(raw2);
    check(name(`${title}: the private copy is gone`), !opfs.includes(`${id}.part`), json(opfs));
    await nothingLeft(title, raw2);
    console.log(`torture: ${title}: killed at ${D} bytes saved, re-sent ${total - 120_000_000} bytes, relaunch to first request ${first ? first.t - t0 : '?'} ms`);
  });

  await session('SIGKILL, three parts', async (c) => {
    const title = 'SIGKILL, three parts';
    const path = '/file/150000000/p.bin';
    const raw = await c.launch();
    await rawSetDownloads(raw, { parts: 3 });
    await sleep(300);
    const id = await rawAdd(raw, `${fx.base}${path}?rate=5000000`);
    let parts = [];
    for (const end = Date.now() + 60000; ; await sleep(500)) {
      const r = (await rawRecords(raw)).find((x) => x.id === id);
      if (r) parts = r.parts;
      if (parts.length === 3 && parts.every((p) => p.done > 0) && parts.reduce((n, p) => n + p.done, 0) > 45_000_000) break;
      if (Date.now() > end) throw new Error(`the parts never passed 45 MB; parts ${json(parts)}`);
    }
    await raw.kill('SIGKILL');
    const mark = fx.log.length;
    const t0 = Date.now();
    const raw2 = await c.launch();
    const r = await waitRecord(raw2, (x) => x.id === id && x.state === 'done', 90000, title);
    const resumed = ranges(fx.log, path, mark);
    const total = sentBytes(fx.log, path);
    check(name(`${title}: every part resumed, none from 0`), parts.every((p) => resumed.some((q) => q.start >= p.start + p.done && q.start <= p.end)) && resumed.every((q) => q.start > 0), json({ parts, resumed }));
    check(name(`${title}: no request starts behind its part's saved offset`), behindCheckpoint(fx.log, path, parts, mark, fx.log.length).length === 0, json({ parts, resumed }));
    check(name(`${title}: the fixture sent at most the size plus 4 checkpoints`), total <= 150_000_000 + 3 * CHECKPOINT + CHECKPOINT, `sent ${total}: ${json(fx.log.filter((l) => l.path === path).map((l) => [l.range, l.status, l.closed ? l.sent : null]))}`);
    await onlyFile(title, c.downloadsDir, 'Other/p.bin', 150_000_000);
    check(name(`${title}: the record has its saved path`), !!r.savedPath, json(r.savedPath));
    await nothingLeft(title, raw2);
    console.log(`torture: ${title}: re-sent ${total - 150_000_000} bytes, relaunch to first request ${resumed[0] ? resumed[0].t - t0 : '?'} ms`);
  });

  // The plan's 20 MB/s per part ends 150 MB in under three seconds, before five closes fit; 4 MB/s per part takes about 12 s.
  await session('engine closed five times', async (c) => {
    const title = 'engine closed five times';
    const path = '/file/150000000/c.bin';
    const raw = await c.launch();
    await rawSetDownloads(raw, { parts: 3 });
    await sleep(300);
    const id = await rawAdd(raw, `${fx.base}${path}?rate=4000000`);
    const cycles = [];
    let prev = [];
    for (let k = 0; k < 5; k++) {
      await waitRecord(raw, (r) => r.id === id && r.state === 'running' && r.parts.length === 3 && r.parts.every((p) => p.done > (prev.find((q) => q.start === p.start)?.done ?? 0)), 60000, `${title}, close ${k + 1}`);
      await sleep(500);
      await raw.evalSw('chrome.offscreen.closeDocument()');
      await until(async () => (await rawEngines(raw)) === 0, 10000);
      const stored = (await rawRecords(raw)).find((r) => r.id === id);
      prev = stored.parts;
      cycles.push({ mark: fx.log.length, parts: stored.parts });
      await rawSend(raw, { type: 'dl-do', op: 'pause', ids: [] });
      await until(async () => (await rawEngines(raw)) >= 1, 20000);
    }
    const r = await waitRecord(raw, (x) => x.id === id && x.state === 'done', 120000, title);
    const behind = cycles.flatMap((cy, k) => behindCheckpoint(fx.log, path, cy.parts, cy.mark, cycles[k + 1]?.mark ?? fx.log.length));
    const zeros = ranges(fx.log, path, cycles[0].mark).filter((q) => q.start === 0);
    const total = sentBytes(fx.log, path);
    check(name(`${title}: no request after a close starts behind its part's saved offset`), behind.length === 0, json(behind));
    check(name(`${title}: no request after the first close starts at 0`), zeros.length === 0, json(zeros));
    check(name(`${title}: the fixture sent at most the size plus five times four checkpoints`), total <= 150_000_000 + 5 * (3 * CHECKPOINT + CHECKPOINT), `sent ${total}: ${json(fx.log.filter((l) => l.path === path).map((l) => [l.range, l.status, l.closed ? l.sent : null]))}`);
    await onlyFile(title, c.downloadsDir, 'Other/c.bin', 150_000_000);
    check(name(`${title}: the record has its saved path`), !!r.savedPath, json(r.savedPath));
    await nothingLeft(title, raw);
    console.log(`torture: ${title}: re-sent ${total - 150_000_000} bytes over five closes`);
  });

  await session('part file deleted', async (c) => {
    const title = 'part file deleted';
    const path = '/file/60000000/o1.bin';
    const raw = await c.launch();
    const id = await rawAdd(raw, `${fx.base}${path}?rate=10000000`);
    const before = await waitRecord(raw, (r) => r.id === id && r.state === 'running' && got(r) > 20_000_000, 60000, title);
    await raw.evalSw('chrome.offscreen.closeDocument()');
    await until(async () => (await rawEngines(raw)) === 0, 10000);
    await evalHub(raw, async (n) => (await navigator.storage.getDirectory()).removeEntry(n), `${id}.part`);
    const mark = fx.log.length;
    await rawSend(raw, { type: 'dl-do', op: 'pause', ids: [] });
    const r = await waitRecord(raw, (x) => x.id === id && x.state === 'done', 90000, title);
    const first = ranges(fx.log, path, mark)[0];
    check(name(`${title}: the record survived with progress and restarted from 0`), got(before) > 20_000_000 && first?.start === 0, json({ saved: got(before), first }));
    await onlyFile(title, c.downloadsDir, 'Other/o1.bin', 60_000_000);
    check(name(`${title}: the record has its saved path`), !!r.savedPath, json(r.savedPath));
    await nothingLeft(title, raw);
  });

  await session('SIGKILL while saving', async (c) => {
    const title = 'SIGKILL while saving';
    const path = '/file/30000000/s.zip';
    const raw = await c.launch();
    await raw.evalSw(`(() => { const o = chrome.downloads.download; self.__held = []; chrome.downloads.download = async (opts, ...a) => { const id = await o.call(chrome.downloads, opts, ...a); self.__held.push(id); chrome.downloads.pause(id).catch(() => {}); return id; }; })()`);
    const id = await rawAdd(raw, `${fx.base}${path}`);
    await waitRecord(raw, (r) => r.id === id && r.state === 'saving', 60000, `${title}, saving`);
    await until(async () => (await raw.evalSw('self.__held.length')) >= 1, 15000);
    await sleep(300);
    await raw.kill('SIGKILL');
    const mark = fx.log.length;
    const raw2 = await c.launch();
    const r = await waitRecord(raw2, (x) => x.id === id && x.state === 'done', 90000, title);
    const files = walk(c.downloadsDir).filter((f) => !f.endsWith('.crdownload'));
    const v = await verifyFile(join(c.downloadsDir, 'Archives/s.zip'), 30_000_000);
    const opfs = await rawOpfs(raw2);
    check(name(`${title}: the record saves again and ends done`), r.state === 'done' && !!r.savedPath, json({ state: r.state, savedPath: r.savedPath }));
    check(name(`${title}: Archives/s.zip exists once and verifies`), v.ok && files.length === 1 && files[0] === 'Archives/s.zip', json({ v, files }));
    check(name(`${title}: the second save needed no new request`), fx.log.slice(mark).filter((l) => l.path === path && !l.closed).length === 0, json(fx.log.slice(mark)));
    check(name(`${title}: the private copy is gone`), !opfs.includes(`${id}.part`), json(opfs));
    await nothingLeft(title, raw2);
  });

  await session('SIGKILL after a take-over', async (c) => {
    const title = 'SIGKILL after a take-over';
    const path = '/file/100000000/t.zip';
    const raw = await c.launch();
    await raw.openPage(`${fx.base}/page?to=${path}?rate=15000000`);
    const rec = await waitRecord(raw, (r) => r.source === 'takeover' && got(r) > 30_000_000, 60000, `${title}, take-over`);
    await raw.kill('SIGKILL');
    const mark = fx.log.length;
    const t0 = Date.now();
    const raw2 = await c.launch();
    const r = await waitRecord(raw2, (x) => x.id === rec.id && x.state === 'done', 90000, title);
    const first = ranges(fx.log, path, mark)[0];
    check(name(`${title}: the record was a take-over and it completes`), r.source === 'takeover' && r.state === 'done', json({ source: r.source, state: r.state }));
    check(name(`${title}: it resumed above 0`), first && first.start > 0, json(first));
    // Chrome's own request has no Range header and the probe asks for bytes=0-0: what is left is what the engine fetched.
    const engineSent = fx.log.filter((l) => l.path === path && !l.closed && l.range && l.range !== 'bytes=0-0').reduce((n, l) => n + (l.sent ?? 0), 0);
    check(name(`${title}: the engine fetched at most the size plus 16 MiB across the kill`), engineSent >= 100_000_000 && engineSent <= 100_000_000 + MiB16, `engine ${engineSent}: ${json(fx.log.filter((l) => l.path === path).map((l) => [l.range, l.status, l.sent]))}`);
    await onlyFile(title, c.downloadsDir, 'Archives/t.zip', 100_000_000);
    await nothingLeft(title, raw2);
    console.log(`torture: ${title}: the engine re-sent ${engineSent - 100_000_000} bytes; ${sentBytes(fx.log, path) - 100_000_000} bytes beyond the size with Chrome's own cancelled request; relaunch to first request ${first ? first.t - t0 : '?'} ms`);
  });

  const page = await extPage(t);
  const usage = () => page.evaluate(async () => (await navigator.storage.estimate()).usage);
  const addVia = async (url, referrer) => {
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', url, ...(referrer ? { referrer } : {}) }] });
    if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
    return reply.ids[0];
  };
  const record = async (id) => (await readRecords(t)).find((r) => r.id === id);
  const refererRules = () => page.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id >= 1000 && r.id < 2000).map((r) => r.id));
  const leftovers = async (title) => {
    const keys = [...Object.keys((await localGet(t, null)) ?? {}).filter((k) => k.startsWith('dlTakeover:')), ...Object.keys((await sessionGet(t, null)) ?? {}).filter((k) => k.startsWith('dlSave:'))];
    check(name(`${title}: no dlTakeover or dlSave key is left`), keys.length === 0, json(keys));
  };

  await attempt('delete', async () => {
    fx.reset();
    await resetDl(t);
    const before = await usage();
    const id = await addVia(`${fx.base}/file/60000000/d.bin?rate=5000000`, 'https://ref.example.org/page');
    await until(async () => (await record(id))?.state === 'running' && got(await record(id)) > 0 && (await opfsNames(t)).includes(`${id}.part`), 30000);
    const ruleBefore = await until(async () => (await refererRules()).length > 0, 5000).catch(() => false);
    const mid = await usage();
    const reply = await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
    const partGone = await until(async () => !(await opfsNames(t)).includes(`${id}.part`), 3000).catch(() => false);
    const rulesGone = await until(async () => (await refererRules()).length === 0, 3000).catch(() => false);
    const lowered = await until(async () => (await usage()) < before + 5_000_000, 10000).catch(() => false);
    const after = await usage();
    check(name('delete: the running record had a Referer rule and a private copy'), ruleBefore && mid > before, json({ ruleBefore, before, mid }));
    check(name('delete: dl-do remove answers ok'), reply?.ok === true, json(reply));
    check(name('delete: the private copy is gone within 3 s'), partGone, json(await opfsNames(t)));
    check(name('delete: its session rules are gone within 3 s'), rulesGone, json(await refererRules()));
    check(name('delete: storage usage is below its value before the download plus 5 MB'), lowered, json({ before, mid, after }));
    check(name('delete: the record is gone'), (await record(id)) === undefined, json(await record(id)));
    await leftovers('delete');
  });

  await attempt('orphan sweep', async () => {
    fx.reset();
    await resetDl(t);
    const id = await addVia(`${fx.base}/file/30000000/o.bin?rate=2000000`);
    await until(async () => got((await record(id)) ?? { parts: [] }) > 0 && (await opfsNames(t)).includes(`${id}.part`), 30000);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [id] });
    const live = await until(async () => ((await record(id))?.state === 'paused' ? await record(id) : null), 15000);
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for (const n of ['dzzzz.part', 'notes.txt']) {
        const w = await (await root.getFileHandle(n, { create: true })).createWritable();
        await w.write(new Uint8Array(1000));
        await w.close();
      }
    });
    await page.evaluate(() => chrome.offscreen.closeDocument());
    await until(async () => (await engineCount(t)) === 0, 10000);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
    const swept = await until(async () => !(await opfsNames(t)).includes('dzzzz.part'), 15000).catch(() => false);
    const names = await opfsNames(t);
    const kept = await page
      .evaluate(
        async ([n, done]) => {
          const f = await (await (await navigator.storage.getDirectory()).getFileHandle(n)).getFile();
          const bytes = new Uint8Array(await f.slice(0, done).arrayBuffer());
          for (let i = 0; i < bytes.length; i++) if (bytes[i] !== i % 251) return { size: f.size, ok: false };
          return { size: f.size, ok: bytes.length === done };
        },
        [`${id}.part`, got(live)],
      )
      .catch((e) => ({ size: -1, ok: false, e: String(e) }));
    check(name('orphan sweep: dzzzz.part (no record) is gone'), swept, json(names));
    check(name('orphan sweep: notes.txt remains'), names.includes('notes.txt'), json(names));
    check(name('orphan sweep: the part file of the live record is untouched'), names.includes(`${id}.part`) && kept.ok && kept.size === 30_000_000, json({ kept, done: got(live) }));
    await leftovers('orphan sweep');
  });

  await leftovers('at the end');
  await resetDl(t);
  await page.close();
}
