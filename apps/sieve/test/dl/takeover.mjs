// Take-over and Retry in Chrome (Task 3.13). Downloads start the way a person starts them: a page whose link Chrome downloads.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ERRORS } from '@apps-hub/sieve-core/src/dl-record.ts';
import { DEFAULT_DOWNLOADS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { stopWorker } from '../harness.mjs';
import { extPage, localGet, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const SIZE = 20_000_000;
const probes = (fx, path) => fx.log.filter((l) => l.path === path && l.range === 'bytes=0-0');
const nonProbeRanged = (fx, path) => fx.log.filter((l) => l.path === path && !l.closed && l.range != null && l.range !== 'bytes=0-0');
const takeOverOn = (extra = {}) => ({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, minMb: 1, ...extra } });

export async function run(t) {
  if (!t.fx) return t.check('downloads: take-over needs the fixture server', false);
  const { check, fx } = t;
  const hub = await extPage(t, 'options.html');
  const pages = [];
  const items = () => hub.evaluate(() => chrome.downloads.search({}));
  const wake = () => sendMsg(t, { type: 'dl-noop' }).catch(() => {});
  const wrap = () =>
    t.sw.evaluate(() => {
      if (self.__log) return;
      self.__log = [];
      for (const n of ['pause', 'resume', 'cancel', 'erase']) {
        const original = chrome.downloads[n];
        chrome.downloads[n] = function (...a) {
          self.__log.push({ n, id: typeof a[0] === 'number' ? a[0] : a[0]?.id, t: Date.now() });
          return original.apply(chrome.downloads, a);
        };
      }
      chrome.downloads.onCreated.addListener((i) => self.__log.push({ n: 'created', id: i.id, t: Date.now() }));
    });
  const log = () => t.sw.evaluate(() => self.__log ?? []);
  const fresh = async (patch = takeOverOn()) => {
    for (const p of pages.splice(0)) await p.close().catch(() => {});
    fx.reset();
    await resetDl(t);
    await hub.evaluate(() => chrome.downloads.erase({}));
    await wrap();
    await t.sw.evaluate(() => {
      self.__log.length = 0;
      if (self.__origCreate) chrome.offscreen.createDocument = self.__origCreate;
    });
    await setDownloads(t, patch);
  };
  const start = async (path, { post = false } = {}) => {
    const p = await t.ctx.newPage();
    pages.push(p);
    await p.goto(`${fx.base}/page?to=${encodeURIComponent(path)}${post ? '&method=post' : ''}`, { waitUntil: 'commit' }).catch(() => {});
    return p;
  };
  const startFrom = async (page, url) => {
    await page.evaluate((u) => {
      const a = document.createElement('a');
      a.href = u;
      document.body.append(a);
      a.click();
    }, url);
  };
  const chromeItems = async (pathOnly) => (await items()).filter((i) => i.url.includes(pathOnly));
  const verifies = (item, size) => {
    try {
      return existsSync(item.filename) && statSync(item.filename).size === size && readFileSync(item.filename).equals(fx.pattern(0, size));
    } catch {
      return false;
    }
  };
  const complete = (pathOnly) =>
    until(async () => {
      const l = await chromeItems(pathOnly);
      return l.length > 0 && l.every((i) => i.state === 'complete') ? l : null;
    }, 40000).catch(async (e) => Promise.reject(new Error(`${e.message}; items ${json((await items()).map((i) => [i.url.slice(-30), i.state, i.paused, i.bytesReceived, i.error]))}; local ${json(Object.keys(await localGet(t, null)))}`)));
  const attempt = async (name, fn) => {
    if (process.env.TK_ONLY && !name.includes(process.env.TK_ONLY)) return;
    try {
      await fn();
    } catch (e) {
      check(`downloads: take-over: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  const recordsFor = async (pathOnly) => (await readRecords(t)).filter((r) => r.url.includes(pathOnly));
  const finished = (pathOnly, ms = 40000) =>
    until(async () => {
      const r = (await recordsFor(pathOnly))[0];
      if (r?.state === 'failed') throw new Error(`failed: ${r.error}`);
      return r?.state === 'done' && r.savedPath ? r : null;
    }, ms);

  await attempt('take-over', async () => {
    await fresh();
    await start(`/file/${SIZE}/a.zip?rate=10000000`);
    const r = await until(async () => (await recordsFor('/file/20000000/a.zip'))[0], 15000);
    check('downloads: take-over: a record appears with source takeover and a chromeId', r.source === 'takeover' && typeof r.chromeId === 'number', json({ source: r.source, chromeId: r.chromeId }));
    const done = await finished('/file/20000000/a.zip');
    const l = await chromeItems('/file/20000000/a.zip');
    const saves = (await items()).filter((i) => i.url.startsWith('blob:chrome-extension://'));
    check('downloads: take-over: Chrome keeps only the blob save, and the saved file verifies', done.chromeId === r.chromeId && l.length === 0 && saves.length === 1 && saves[0].state === 'complete' && verifies(saves[0], SIZE), json({ originals: l.length, saves: saves.map((s) => [s.state, s.filename]) }));
    const reqs = fx.log.filter((x) => x.path === '/file/20000000/a.zip' && !x.closed);
    const before = reqs.length;
    check('downloads: take-over: the log shows Chrome request, one probe, then ranged requests', reqs[0]?.range === null && probes(fx, '/file/20000000/a.zip').length === 1 && reqs.slice(2).every((x) => x.range?.startsWith('bytes=')), json(reqs.map((x) => x.range)));
    await new Promise((r) => setTimeout(r, 1500));
    check('downloads: take-over: no request follows the completion', fx.log.filter((x) => x.path === '/file/20000000/a.zip' && !x.closed).length === before);
    const calls = await log();
    const created = calls.find((c) => c.n === 'created' && c.id === r.chromeId);
    const paused = calls.find((c) => c.n === 'pause' && c.id === r.chromeId);
    check('downloads: take-over: pause was called less than 100 ms after onCreated', created && paused && paused.t - created.t < 100, json({ created, paused }));
  });

  await attempt('not taken', async () => {
    const cases = [
      ['a file below minMb', `/file/500000/small.zip`, 500000, takeOverOn()],
      ['a text/html file', `/file/9000000/a.html?type=text/html`, 9000000, takeOverOn()],
      ['takeOver.on false', `/file/${SIZE}/off1.zip`, SIZE, takeOverOn({ on: false })],
      ['downloads.on false', `/file/${SIZE}/off2.zip`, SIZE, { ...takeOverOn(), on: false }],
    ];
    for (const [name, path, size, patch] of cases) {
      await fresh(patch);
      await start(path);
      const only = path.split('?')[0];
      const l = await complete(only);
      const calls = await log();
      check(`downloads: take-over: ${name} is not taken`, calls.every((c) => c.n !== 'pause') && (await readRecords(t)).length === 0 && verifies(l[0], size), json({ calls: calls.map((c) => c.n), records: (await readRecords(t)).length }));
    }
  });

  const matrix = [
    ['probeSize', `/shape/${SIZE}/s.zip?probeSize=19999999`, false],
    ['probeType', `/shape/${SIZE}/t.zip?probeType=text/html`, false],
    ['probeStatus 429', `/shape/${SIZE}/p.zip?probeStatus=429`, false],
    ['ranges=no', `/file/${SIZE}/n.zip?ranges=no`, false],
    ['one-time link', `/file/${SIZE}/o.zip?once=tok1`, false],
    ['gzip', `/file/${SIZE}/z.zip?enc=gzip`, false],
    ['POST', `/form/${SIZE}/f.zip`, true],
    ['probe timeout', `/shape/${SIZE}/d.zip?probeDelay=12000`, false],
  ];
  for (const [name, path, post] of matrix) {
    await attempt(`leave: ${name}`, async () => {
      await fresh();
      await start(path, { post });
      const only = path.split('?')[0];
      if (name === 'gzip') {
        // Chrome cannot decode the fixture's plain bytes labelled gzip, so its own item may fail or not count as a candidate at all;
        // either way Sieve must not take it: no record, no cancel, a pause is always followed by a resume.
        await new Promise((r) => setTimeout(r, 8000));
        const calls = await log();
        const paused = calls.some((c) => c.n === 'pause');
        check('downloads: take-over: gzip: Sieve takes nothing (no record, no cancel, a pause is resumed)', (await readRecords(t)).length === 0 && !calls.some((c) => c.n === 'cancel') && (!paused || calls.some((c) => c.n === 'resume')) && nonProbeRanged(fx, only).length === 0, json({ calls: calls.map((c) => c.n), ranged: nonProbeRanged(fx, only) }));
        return;
      }
      const l = await complete(only);
      const calls = await log();
      const all = await items();
      check(`downloads: take-over: ${name}: Chrome keeps the download, once, byte-correct, with no record`, all.length === 1 && l.length === 1 && verifies(l[0], SIZE) && (await readRecords(t)).length === 0 && calls.some((c) => c.n === 'resume') && nonProbeRanged(fx, only).length === 0 && !calls.some((c) => c.n === 'cancel'), json({ items: all.length, records: (await readRecords(t)).length, calls: calls.map((c) => c.n), ranged: nonProbeRanged(fx, only) }));
    });
  }

  await attempt('cookies and Referer', async () => {
    await fresh();
    const page = await t.ctx.newPage();
    pages.push(page);
    await page.goto(`${fx.base}/set-cookie`);
    await startFrom(page, `${fx.base}/file/${SIZE}/c.zip?cookie=1&rate=10000000`);
    const c = await until(async () => (await recordsFor('/file/20000000/c.zip'))[0], 15000);
    const ref = `${fx.base}/set-cookie`;
    await startFrom(page, `${fx.base}/file/${SIZE}/r.zip?ref=${ref}&rate=10000000`);
    const r = await until(async () => (await recordsFor('/file/20000000/r.zip'))[0], 15000);
    check('downloads: take-over: the probe carries the page cookies', c.source === 'takeover' && probes(fx, '/file/20000000/c.zip')[0]?.status === 206 && probes(fx, '/file/20000000/c.zip')[0]?.cookie?.includes('sid=abc'), json(probes(fx, '/file/20000000/c.zip')));
    check('downloads: take-over: the probe carries the Referer through the session rule', r.source === 'takeover' && probes(fx, '/file/20000000/r.zip')[0]?.referer === ref, json(probes(fx, '/file/20000000/r.zip')));
  });

  await attempt('own saves are never taken over again', async () => {
    await fresh(takeOverOn({ minMb: 0 }));
    await start(`/file/${SIZE}/own.zip?rate=10000000`);
    await finished('/file/20000000/own.zip');
    await new Promise((r) => setTimeout(r, 1500));
    const calls = await log();
    check('downloads: take-over: no paused item, one probe and one pause after the save', (await items()).every((i) => !i.paused) && probes(fx, '/file/20000000/own.zip').length === 1 && calls.filter((c) => c.n === 'pause').length === 1, json({ calls: calls.map((c) => c.n), probes: probes(fx, '/file/20000000/own.zip').length }));
  });

  await attempt('Retry in Chrome', async () => {
    await fresh();
    await start(`/flip/${SIZE}/g.zip?rate=8000000`);
    const rec = await until(async () => (await recordsFor('/flip/20000000/g.zip'))[0], 15000);
    await t.sw.evaluate(() => chrome.offscreen.closeDocument()).catch(() => {});
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
    await until(async () => (await recordsFor('/flip/20000000/g.zip'))[0]?.state === 'failed', 30000).catch(async (e) => Promise.reject(new Error(`not failed: ${e.message}; ${json((await readRecords(t)).map((r) => [r.state, r.error, r.parts]))}; ${json(fx.log.filter((l) => l.path.includes('flip')).slice(-6))}`)));
    const failed = (await recordsFor('/flip/20000000/g.zip'))[0];
    check('downloads: take-over: a changed file fails with the changed sentence', failed.error === ERRORS.changed, json(failed.error));
    const probesBefore = probes(fx, '/flip/20000000/g.zip').length;
    let violation = null;
    let sampling = true;
    const watcher = (async () => {
      while (sampling) {
        const stillThere = (await recordsFor('/flip/20000000/g.zip')).length > 0;
        const started = (await chromeItems('/flip/20000000/g.zip')).some((i) => i.bytesReceived > 0 || i.state === 'complete');
        if (!stillThere && !started) violation = 'the record was gone before Chrome had a byte';
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    const reply = await sendMsg(t, { type: 'dl-retry-chrome', id: rec.id });
    const l = await complete('/flip/20000000/g.zip');
    sampling = false;
    await watcher;
    check('downloads: take-over: Retry in Chrome answers ok and Chrome downloads the file', reply?.ok === true && l.length === 1 && verifies(l[0], SIZE), json({ reply, items: l.length }));
    check('downloads: take-over: the record is gone, and was kept until Chrome had a byte', (await recordsFor('/flip/20000000/g.zip')).length === 0 && violation === null, json({ violation, records: (await recordsFor('/flip/20000000/g.zip')).length }));
    check('downloads: take-over: the retry URL was skipped, so no probe follows', probes(fx, '/flip/20000000/g.zip').length === probesBefore, json({ before: probesBefore, after: probes(fx, '/flip/20000000/g.zip').length }));
    const again = await sendMsg(t, { type: 'dl-retry-chrome', id: rec.id });
    check('downloads: take-over: a second retry for the same id answers not ok', again?.ok === false, json(again));
  });

  await attempt('the worker dies while Chrome is paused', async () => {
    await fresh();
    await start(`/shape/${SIZE}/w.zip?probeDelay=6000&rate=10000000`);
    const paused = await until(async () => (await log()).find((c) => c.n === 'pause'), 15000);
    const key = `dlTakeover:${paused.id}`;
    const during = (await localGet(t, key))[key];
    const lag = Date.now() - paused.t;
    const status = await stopWorker(t.ctx);
    await wake();
    const l = await complete('/shape/20000000/w.zip').catch(async (e) => Promise.reject(new Error(`status ${status}; lag ${lag}; pausedAt ${paused.t}; during ${json(during)}; ${e.message}; records ${json((await readRecords(t)).map((r) => [r.state, r.source, r.chromeId]))}; fixture ${json(fx.log.filter((x) => x.path.includes('/shape/')).map((x) => [x.range, x.status, x.closed, x.t]))}`)));
    const after = Object.keys(await localGet(t, null)).filter((k) => k.startsWith('dlTakeover:'));
    check('downloads: take-over: the entry in local storage survives the worker, and the next worker resumes Chrome', status === 'stopped' && during?.url?.includes('/shape/20000000/w.zip') && l.length === 1 && verifies(l[0], SIZE) && (await readRecords(t)).length === 0 && after.length === 0, json({ status, during, items: l.length, after }));
  });

  await attempt('the worker dies after the engine acknowledged', async () => {
    await fresh();
    await t.sw.evaluate(() => {
      chrome.downloads.cancel = () => new Promise(() => {});
    });
    await start(`/file/${SIZE}/k.zip?rate=10000000`);
    const rec = await until(async () => (await recordsFor('/file/20000000/k.zip'))[0], 15000);
    await stopWorker(t.ctx);
    await wake();
    await wrap();
    const done = await finished('/file/20000000/k.zip');
    const all = await items();
    const saves = all.filter((i) => i.url.startsWith('blob:chrome-extension://'));
    check('downloads: take-over: the new worker cancels and erases Chrome\'s item, and one file results', done.id === rec.id && all.length === 1 && saves.length === 1 && verifies(saves[0], SIZE), json({ items: all.map((i) => [i.url.slice(0, 40), i.state]) }));
  });

  await attempt('the engine cannot start', async () => {
    await fresh();
    await t.sw.evaluate(() => {
      self.__origCreate = chrome.offscreen.createDocument;
      chrome.offscreen.createDocument = async () => {
        throw new Error('blocked for the test');
      };
    });
    await start(`/file/${SIZE}/e.zip`);
    const l = await complete('/file/20000000/e.zip');
    check('downloads: take-over: Chrome keeps the download when the engine cannot acknowledge', l.length === 1 && verifies(l[0], SIZE) && (await readRecords(t)).length === 0, json({ items: l.length }));
  });

  await attempt('cancel fails', async () => {
    await fresh();
    await t.sw.evaluate(() => {
      const original = chrome.downloads.cancel;
      let failed = false;
      chrome.downloads.cancel = function (...a) {
        if (!failed) {
          failed = true;
          return Promise.reject(new Error('nope'));
        }
        return original.apply(chrome.downloads, a);
      };
    });
    await start(`/file/${SIZE}/x.zip?rate=10000000`);
    const l = await complete('/file/20000000/x.zip');
    await until(async () => (await readRecords(t)).length === 0, 15000);
    check('downloads: take-over: a failed cancel removes the new record and Chrome finishes once', l.length === 1 && (await items()).length === 1 && verifies(l[0], SIZE), json({ items: (await items()).length }));
  });

  await hub.close();
  for (const p of pages.splice(0)) await p.close().catch(() => {});
}
