import { stopWorker } from '../harness.mjs';
import { engineCount, extPage, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const closeEngine = (t) => t.sw.evaluate(() => chrome.offscreen.closeDocument());
const wake = (t) => sendMsg(t, { type: 'dl-noop' }).catch(() => {});
const done = (r) => r.parts.reduce((n, p) => n + p.done, 0);
const alarm = (t, name) => t.sw.evaluate((n) => chrome.alarms.get(n), name);
const rules = (t) => t.sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
const requests = (t, path) => t.fx.log.filter((l) => l.path === path && !l.closed);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

async function add(t, item) {
  const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', ...item }] });
  if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
  return reply.ids[0];
}
const get = async (t, id) => (await readRecords(t)).find((r) => r.id === id);
const reach = (t, id, state, ms = 20000) => until(async () => {
  const r = await get(t, id);
  return [state].flat().includes(r?.state) ? r : r?.state === 'failed' && state !== 'failed' ? Promise.reject(new Error(`failed: ${r.error}`)) : null;
}, ms);

export async function run(t) {
  if (!t.fx) return t.check('downloads: router needs the fixture server', false);
  const { check, fx } = t;
  const states = await extPage(t, 'options.html');
  await states.evaluate(() => {
    window.__states = new Map();
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'dl-state') for (const r of m.records) window.__states.set(r.id, r);
    });
  });
  const live = (id) => states.evaluate((i) => window.__states.get(i), id);
  const fresh = async (patch = {}) => {
    fx.reset();
    await resetDl(t);
    await states.evaluate(() => window.__states.clear());
    if (Object.keys(patch).length) await setDownloads(t, patch);
  };
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: router: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  // The first request a download makes after `from` log entries starts at a saved offset, never at 0.
  const resumedAbove0 = async (path, from) => {
    // The engine probes again after a restart (bytes=0-0); the first real range must start at a saved offset.
    const next = await until(() => requests(t, path).slice(from).find((l) => l.range && l.range !== 'bytes=0-0'), 15000);
    const start = Number(/^bytes=(\d+)-/.exec(next.range)?.[1] ?? -1);
    return { ok: start > 0, range: next.range };
  };

  await attempt('reconcile at worker start', async () => {
    await fresh();
    const path = '/file/20000000/s.bin';
    const id = await add(t, { url: `${fx.base}${path}?rate=5000000` });
    await until(async () => done((await get(t, id)) ?? { parts: [] }) > 0, 15000);
    await closeEngine(t);
    const stopped = await stopWorker(t.ctx);
    const seen = requests(t, path).length;
    await wake(t);
    const back = await until(async () => (await engineCount(t)) === 1, 5000).catch(() => false);
    const resumed = await resumedAbove0(path, seen);
    check('downloads: router: a restarted worker brings the engine back and the download resumes above byte 0', stopped === 'stopped' && back && resumed.ok, json({ stopped, back, resumed }));
  });

  await attempt('watchdog', async () => {
    await fresh();
    const path = '/file/20000000/w.bin';
    const id = await add(t, { url: `${fx.base}${path}?rate=3000000` });
    await until(async () => done((await get(t, id)) ?? { parts: [] }) > 0, 15000);
    const present = await until(() => alarm(t, 'dl-watchdog'), 5000).catch(() => null);
    await closeEngine(t);
    const seen = requests(t, path).length;
    await t.sw.evaluate(() => chrome.alarms.create('dl-watchdog', { delayInMinutes: 0.05, periodInMinutes: 1 }));
    const back = await until(async () => (await engineCount(t)) === 1, 10000).catch(() => false);
    const resumed = await resumedAbove0(path, seen);
    check('downloads: router: the watchdog alarm brings a closed engine back with no message, and the alarm exists while work is runnable', !!present && back && resumed.ok, json({ present, back, resumed }));
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [id] });
    const gone = await until(async () => (await alarm(t, 'dl-watchdog')) === undefined, 5000).catch(() => false);
    check('downloads: router: the watchdog is cleared once every record is paused', gone);
  });

  await attempt('idle close', async () => {
    await fresh();
    await wake(t);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
    await until(async () => (await engineCount(t)) === 1, 5000);
    const reply = await sendMsg(t, { type: 'dl-sw-idle' });
    const closed = await until(async () => (await engineCount(t)) === 0, 5000).catch(() => false);
    check('downloads: router: dl-sw-idle with nothing to do closes the engine and replies ok', reply?.ok === true && closed, json({ reply, closed }));
    const id = await add(t, { url: `${fx.base}/file/20000000/i.bin?rate=2000000` });
    await until(async () => done((await get(t, id)) ?? { parts: [] }) > 0, 15000);
    const kept = await sendMsg(t, { type: 'dl-sw-idle' });
    await new Promise((r) => setTimeout(r, 500));
    check('downloads: router: dl-sw-idle with a running record leaves the engine open', kept?.ok === true && (await engineCount(t)) === 1, json({ kept, engines: await engineCount(t) }));
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
  });

  await attempt('config push', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/60000000/c.bin?rate=8000000` });
    await until(async () => done((await get(t, id)) ?? { parts: [] }) > 0, 15000);
    await setDownloads(t, { speedLimit: { on: true, kbPerSecond: 1000 } });
    await new Promise((r) => setTimeout(r, 700));
    const a = done(await live(id));
    await new Promise((r) => setTimeout(r, 3000));
    const b = done(await live(id));
    const rate = (b - a) / 3;
    check('downloads: router: a speed limit set while the engine runs slows it without a reload (under 1.5 MB/s)', rate > 0 && rate < 1_500_000, json({ a, b, rate }));
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
  });

  await attempt('session rules follow records', async () => {
    await fresh();
    const ref = 'https://files.example.org/page';
    const id = await add(t, { url: `${fx.base}/file/30000000/r.bin?rate=3000000&ref=${encodeURIComponent(ref)}`, referrer: ref });
    const has = (list) => list.some((r) => r.id >= 1000 && r.id <= 1999 && r.action?.requestHeaders?.[0]?.value === ref);
    const added = await until(async () => has(await rules(t)), 2000).catch(() => false);
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
    const removed = await until(async () => !has(await rules(t)), 3500).catch(() => false);
    check('downloads: router: a record with a referrer has a session rule from id 1000, and the rule is gone within 3 s of the record being removed', added && removed, json({ added, removed }));
  });

  await attempt('redirect target rule (O2)', async () => {
    await fresh();
    const ref = 'https://files.example.org/page';
    const target = `${fx.base}/file/20000000/o2.bin?rate=3000000`;
    const id = await add(t, { url: `${fx.base}/redirect/1?to=${encodeURIComponent(`/file/20000000/o2.bin?rate=3000000`)}`, referrer: ref });
    const record = await until(async () => {
      const r = await get(t, id);
      return r && r.finalUrl !== r.url ? r : null;
    }, 15000);
    const filter = (r) => r.condition?.urlFilter === `|${record.finalUrl}|`;
    const ruled = await until(async () => (await rules(t)).some(filter), 3000).catch(() => false);
    check('downloads: router: a redirect target gets its own Referer rule once the record shows its final address', record.finalUrl === target && ruled, json({ finalUrl: record.finalUrl, ruled, rules: (await rules(t)).map((r) => [r.id, r.condition?.urlFilter]), live: (await live(id))?.finalUrl }));
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
  });

  await attempt('schedule window', async () => {
    await fresh();
    const open = new Date(Date.now() + 60_000);
    const queue = { id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: true, days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(open), stop: null } };
    await setDownloads(t, { queues: [queue] });
    const path = '/file/3000000/win.bin';
    const id = await add(t, { url: `${fx.base}${path}?rate=300000` });
    const before = await until(() => alarm(t, 'dl-schedule'), 5000).catch(() => null);
    await closeEngine(t);
    await new Promise((r) => setTimeout(r, 1500));
    const waiting = await get(t, id);
    check('downloads: router: a record in a closed window stays queued, the schedule alarm exists, and no engine runs', waiting?.state === 'queued' && !!before && (await engineCount(t)) === 0 && requests(t, path).length === 0, json({ state: waiting?.state, before, engines: await engineCount(t), requests: requests(t, path).length }));
    const started = await until(async () => (await engineCount(t)) === 1 && (await get(t, id))?.state === 'running', 100_000).catch(() => false);
    const during = await until(() => alarm(t, 'dl-schedule'), 5000).catch(() => null);
    check('downloads: router: the schedule alarm opens the window, the engine appears and the record runs, and the alarm exists while it runs', !!started && !!during, json({ started, during }));
    await reach(t, id, ['saving', 'done'], 30000);
    await sendMsg(t, { type: 'dl-do', op: 'remove', ids: [id] });
  });

  await resetDl(t);
}
