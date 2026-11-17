// Finishing (Task 3.12): the private copy goes to Downloads/<category> through chrome.downloads from a blob URL.
import { execSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startWorker, stopWorker } from '../harness.mjs';
import { ERRORS } from '@apps-hub/sieve-core/src/dl-record.ts';
import { validateDownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { extPage, localGet, opfsNames, readRecords, resetDl, sendMsg, sessionGet, setDownloads, until } from './_helpers.mjs';
import { launchRaw } from './_raw-chrome.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);

// byte i is i % 251, read in 1 MiB slices (the file may be large)
function verify(path, size) {
  if (!existsSync(path) || statSync(path).size !== size) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let off = 0; off < size; ) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, size - off), off);
      if (n <= 0) return false;
      for (let i = 0; i < n; i++) if (buf[i] !== (off + i) % 251) return false;
      off += n;
    }
    return true;
  } finally {
    closeSync(fd);
  }
}

// resident memory of this run's browser: every descendant of this node process (other agents' Chrome instances are not counted)
const rssMB = () => {
  const rows = execSync('ps -axo pid=,ppid=,rss=', { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const mine = new Set([process.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of rows) if (mine.has(ppid) && !mine.has(pid)) (mine.add(pid), (grew = true));
  }
  return Math.round(rows.filter(([pid]) => pid !== process.pid && mine.has(pid)).reduce((n, [, , rss]) => n + rss, 0) / 1024);
};

export async function run(t) {
  if (!t.fx) return t.check('downloads: save needs the fixture server', false);
  const { check, fx } = t;
  let sw = t.sw;
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: save: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  const add = async (url, patch = {}) => {
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', url, ...patch }] });
    if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
    return reply.ids[0];
  };
  const get = async (id) => (await readRecords(t)).find((r) => r.id === id);
  const reach = (id, state, ms = 40000) =>
    until(async () => {
      const r = await get(id);
      return r?.state === state ? r : r?.state === 'failed' && state !== 'failed' ? Promise.reject(new Error(`failed: ${r.error}`)) : null;
    }, ms);
  // Wraps chrome.downloads.download in the worker (re-applied after a worker restart): it logs every call, can reject once ('reject-once'),
  // and pauses the save's item the moment Chrome creates it ('pause'), so a test can cancel or resume it.
  const wrap = (worker = sw) =>
    worker.evaluate(() => {
      self.__orig ??= chrome.downloads.download;
      self.__saves = [];
      self.__mode = null;
      self.__paused = null;
      chrome.downloads.download = async (opts, ...rest) => {
        self.__saves.push(opts);
        if (self.__mode === 'reject-once') {
          self.__mode = null;
          throw new Error('boom');
        }
        return self.__orig.call(chrome.downloads, opts, ...rest);
      };
      if (!self.__listening) {
        self.__listening = true;
        chrome.downloads.onCreated.addListener((item) => {
          if (self.__mode === 'pause' && item.url.startsWith('blob:')) {
            self.__mode = null;
            self.__paused = item.id;
            chrome.downloads.pause(item.id);
          }
        });
      }
    });
  const setMode = (mode) => sw.evaluate((m) => (self.__mode = m), mode);
  const saves = () => sw.evaluate(() => self.__saves);
  const chromeItem = (id) => sw.evaluate(async (i) => (await chrome.downloads.search({ id: i }))[0], id);
  const fresh = async (patch = {}) => {
    fx.reset();
    await resetDl(t);
    if (Object.keys(patch).length) await setDownloads(t, patch);
    await wrap();
  };
  const noEntries = () => until(async () => Object.keys(await sessionGet(t, null)).every((k) => !k.startsWith('dlSave:')), 5000).catch(() => false);

  await attempt('complete flow', async () => {
    await fresh();
    const id = await add(`${fx.base}/file/20000000/pack.zip`);
    const r = await reach(id, 'done');
    const item = await chromeItem(r.savedId);
    const s = await saves();
    check('downloads: save: a download reaches done with the saved file right, byte for byte', !!r.savedPath && r.savedPath === item.filename && verify(r.savedPath, 20000000), json({ savedPath: r.savedPath, item }));
    check('downloads: save: the private copy is gone and no dlSave key is left', !(await opfsNames(t)).includes(`${id}.part`) && (await noEntries()), json(await opfsNames(t)));
    check("downloads: save: Chrome was asked for Archives/pack.zip with uniquify, from a blob URL of the extension", s.length === 1 && s[0].filename === 'Archives/pack.zip' && s[0].conflictAction === 'uniquify' && item.url.startsWith('blob:chrome-extension://') && item.byExtensionId === t.id, json({ s, url: item.url, by: item.byExtensionId }));
  });

  await attempt('categories', async () => {
    await fresh();
    const names = { 'movie.mp4': 'Video', 'song.mp3': 'Music', 'App.dmg': 'Programs', 'paper.pdf': 'Documents', 'thing.xyz': 'Other' };
    for (const name of Object.keys(names)) await reach(await add(`${fx.base}/file/300000/${name}`), 'done');
    const got = (await saves()).map((s) => s.filename).sort();
    const want = Object.entries(names).map(([n, f]) => `${f}/${n}`).sort();
    check('downloads: save: each type goes to its category folder', JSON.stringify(got) === JSON.stringify(want), json({ got, want }));
    const settings = validateDownloadSettings((await localGet(t, 'downloads')).downloads);
    await setDownloads(t, { categories: settings.categories.map((c) => (c.id === 'video' ? { ...c, folder: 'Movies' } : c)) });
    await reach(await add(`${fx.base}/file/300000/second.mp4`), 'done');
    check('downloads: save: after the video folder is renamed a new video saves to Movies', (await saves()).at(-1)?.filename === 'Movies/second.mp4', json((await saves()).at(-1)));
  });

  await attempt('same name twice', async () => {
    await fresh();
    const a = await reach(await add(`${fx.base}/file/300000/dup.zip`), 'done');
    const b = await reach(await add(`${fx.base}/file/300001/dup.zip`), 'done');
    check('downloads: save: two records with the same file name both finish with different saved paths', a.savedPath && b.savedPath && a.savedPath !== b.savedPath, json([a.savedPath, b.savedPath]));
  });

  await attempt('a failed save keeps the copy', async () => {
    await fresh();
    await setMode('reject-once');
    const id = await add(`${fx.base}/file/3000000/keep.bin`);
    const failed = await reach(id, 'failed');
    const part = await opfsNames(t);
    check('downloads: save: a rejected save fails the record with the save sentence, saveOnly, and keeps the private copy', failed.error === ERRORS.save('boom') && failed.saveOnly === true && part.includes(`${id}.part`), json({ error: failed.error, saveOnly: failed.saveOnly, part }));
    const before = fx.log.filter((l) => l.path === '/file/3000000/keep.bin').length;
    await sendMsg(t, { type: 'dl-do', op: 'resume', ids: [id] });
    await reach(id, 'done');
    const after = fx.log.filter((l) => l.path === '/file/3000000/keep.bin').length;
    check('downloads: save: Resume saves again without a new network request and removes the copy', after === before && !(await opfsNames(t)).includes(`${id}.part`), json({ before, after }));
  });

  await attempt('cancelled in Chrome', async () => {
    await fresh();
    await setMode('pause');
    const id = await add(`${fx.base}/file/200000000/cancel.bin`);
    const pid = await until(() => sw.evaluate(() => self.__paused), 40000);
    await sw.evaluate((i) => chrome.downloads.cancel(i), pid);
    const failed = await reach(id, 'failed');
    check('downloads: save: a save cancelled in Chrome fails the record with the cancelled sentence and keeps the copy', failed.error === ERRORS.saveCanceled && failed.saveOnly === true && (await opfsNames(t)).includes(`${id}.part`), json({ error: failed.error }));
    await sendMsg(t, { type: 'dl-do', op: 'resume', ids: [id] });
    const done = await reach(id, 'done');
    check('downloads: save: Resume after the cancel completes the file', done.savedPath && statSync(done.savedPath).size === 200000000, json(done.savedPath));
  });

  await attempt('the worker dies after the save started', async () => {
    await fresh();
    await setMode('pause');
    const id = await add(`${fx.base}/file/200000000/survive.bin`);
    const pid = await until(() => sw.evaluate(() => self.__paused), 40000);
    const status = await stopWorker(t.ctx);
    sw = await startWorker(t.ctx, t.id);
    await sw.evaluate((i) => chrome.downloads.resume(i), pid);
    const done = await reach(id, 'done');
    check('downloads: save: a save finishing while the worker was stopped still completes the record', status === 'stopped' && !!done.savedPath && statSync(done.savedPath).size === 200000000, json({ status, savedPath: done.savedPath }));
    await wrap();
  });

  await attempt('real folders', async () => {
    const raw = await launchRaw();
    try {
      const page = `chrome-extension://${raw.id}/options.html`;
      await raw.openPage(page);
      await until(() => raw.evalPage(page, 'document.readyState').then((s) => s === 'complete'), 15000);
      const send = (url) => raw.evalPage(page, `chrome.runtime.sendMessage(${JSON.stringify({ type: 'dl-add', items: [{ source: 'manual', url }] })})`);
      const url = `${fx.base}/file/5000000/clip.mp4`;
      const first = join(raw.downloadsDir, 'Video', 'clip.mp4');
      const reply = await send(url);
      await until(() => verify(first, 5000000), 40000);
      check('downloads: save: in a real Downloads folder the file lands in Video/clip.mp4 with every byte right', reply?.ok === true);
      await send(url);
      const second = join(raw.downloadsDir, 'Video', 'clip (1).mp4');
      await until(() => verify(second, 5000000), 40000);
      check('downloads: save: the same file again is saved as clip (1).mp4', true, json(readdirSync(join(raw.downloadsDir, 'Video'))));
    } finally {
      await raw.close();
    }
  });

  if (t.big) {
    await attempt('big file', async () => {
      await fresh();
      const start = rssMB();
      let peak = start;
      const timer = setInterval(() => (peak = Math.max(peak, rssMB())), 500);
      try {
        const id = await add(`${fx.base}/file/3000000000/big.bin`);
        const r = await reach(id, 'done', 600000);
        const end = rssMB();
        console.log(`big save: resident memory ${start} MB before, peak ${peak} MB, ${end} MB at the end`);
        check('downloads: save: a 3 GB file saves with the right size and the browser grows by under 500 MB', statSync(r.savedPath).size === 3000000000 && peak - start < 500, json({ start, peak, end }));
        rmSync(r.savedPath, { force: true });
      } finally {
        clearInterval(timer);
      }
    });
  }
}
