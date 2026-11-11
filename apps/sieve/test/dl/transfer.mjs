import { ERRORS } from '@apps-hub/sieve-core/src/dl-record.ts';
import { deletePart, extPage, readMeta, readPart, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const closeEngine = (t) => t.sw.evaluate(() => chrome.offscreen.closeDocument());
const wake = (t) => sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
const done = (r) => r.parts.reduce((n, p) => n + p.done, 0);
const requests = (t, path) => t.fx.log.filter((l) => l.path === path && !l.closed);

async function add(t, item) {
  const reply = await sendMsg(t, { type: 'dl-add', items: [{ source: 'manual', ...item }] });
  if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
  return reply.ids[0];
}
const get = async (t, id) => (await readRecords(t)).find((r) => r.id === id);
const reach = (t, id, state, ms = 20000) => until(async () => {
  const r = await get(t, id);
  return r?.state === state ? r : r?.state === 'failed' && state !== 'failed' ? Promise.reject(new Error(`failed: ${r.error}`)) : null;
}, ms);
const progress = (t, id) => until(async () => {
  const r = await get(t, id);
  return r && done(r) > 0 ? r : null;
}, 15000);

export async function run(t) {
  if (!t.fx) return t.check('downloads: transfer needs the fixture server', false);
  const { check, fx } = t;
  const states = await extPage(t, 'options.html');
  await states.evaluate(() => {
    window.__states = new Map();
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === 'dl-state') for (const r of m.records) window.__states.set(r.id, r);
    });
  });
  const fresh = async (patch = {}) => {
    fx.reset();
    // Finishing is checked in save.mjs; here the private copy must stay in OPFS at `saving` so its bytes can be read.
    await t.sw.evaluate(() => { chrome.downloads.download = () => new Promise(() => {}); });
    await resetDl(t);
    await states.evaluate(() => window.__states.clear());
    if (Object.keys(patch).length) await setDownloads(t, patch);
  };
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: transfer: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  // What the engine broadcast matches what it stored (the last broadcast of every record equals its stored copy).
  const consistent = async (name) => {
    let last;
    const ok = await until(async () => {
      const stored = await readRecords(t);
      const seen = await states.evaluate(() => Object.fromEntries(window.__states));
      last = { stored: stored.map((r) => [r.id, r.state, done(r)]), seen: Object.values(seen).map((r) => [r.id, r.state, done(r)]) };
      return stored.length > 0 && stored.every((r) => JSON.stringify(seen[r.id]) === JSON.stringify(r));
    }, 5000).catch(() => false);
    check(`downloads: transfer: ${name}: the stored records match the broadcasts`, ok, json(last));
  };

  await attempt('one part', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/20000000/a.bin` });
    const r = await reach(t, id, 'saving');
    const part = await readPart(t, `${id}.part`);
    const reqs = requests(t, '/file/20000000/a.bin');
    check('downloads: transfer: one part reaches saving with every byte right', r.parts.length === 1 && r.parts.every((p) => p.done === p.end - p.start + 1) && part.size === 20000000 && part.ok, json({ parts: r.parts, part }));
    check('downloads: transfer: the log shows the probe, then a ranged request with If-Range', reqs[0]?.range === 'bytes=0-0' && reqs[1]?.range === 'bytes=0-' && reqs[1]?.ifRange === '"e-20000000"', json(reqs));
    await consistent('one part');
  });

  await attempt('cookies and Referer', async () => {
    await fresh();
    const page = await t.ctx.newPage();
    await page.goto(`${fx.base}/set-cookie`);
    await page.close();
    const c = await add(t, { url: `${fx.base}/file/1000000/c.bin?cookie=1` });
    await reach(t, c, 'saving');
    const sent = requests(t, '/file/1000000/c.bin').map((l) => l.cookie);
    check('downloads: transfer: the page cookies go with the engine requests', sent.length > 0 && sent.every((x) => x?.includes('sid=abc')), json(sent));
    const ref = 'https://files.example.org/page';
    const url = `${fx.base}/file/1000000/r.bin?ref=${encodeURIComponent(ref)}`;
    const ok = await add(t, { url, referrer: ref });
    await reach(t, ok, 'saving');
    check('downloads: transfer: a download added with its referrer carries it (the Referer rule works)', requests(t, '/file/1000000/r.bin').every((l) => l.referer === ref), json(requests(t, '/file/1000000/r.bin')));
    const bad = await add(t, { url: `${fx.base}/file/1000000/r2.bin?ref=${encodeURIComponent(ref)}` });
    const failed = await reach(t, bad, 'failed');
    check('downloads: transfer: the same file without the referrer fails with the status sentence', failed.error === ERRORS.status(403), json(failed.error));
    await consistent('cookies and Referer');
  });

  await attempt("Sieve's own blocking", async () => {
    await fresh();
    const adBase = `http://pagead2.googlesyndication.com:${fx.port}`;
    const a = await add(t, { url: `${adBase}/file/3000000/ad.bin` });
    await reach(t, a, 'saving');
    check("downloads: transfer: a file from an ad host downloads (the allow rule lets the engine past Sieve's blocking)", true);
    await t.sw.evaluate(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1] }));
    try {
      const b = await add(t, { url: `${adBase}/file/3000000/ad2.bin` });
      const failed = await reach(t, b, 'failed', 30000);
      check('downloads: transfer: without the allow rule the same add fails (the rule is what lets it through)', failed.error === ERRORS.probe, json(failed.error));
    await consistent('ad host');
    } finally {
      await t.sw.evaluate(async (id) => {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: [{ id: 1, priority: 2_000_000_000, action: { type: 'allow' }, condition: { initiatorDomains: [id], resourceTypes: ['xmlhttprequest', 'other'] } }] });
      }, t.id);
    }
  });

  await attempt('three parts', async () => {
    await fresh({ parts: 3 });
    const id = await add(t, { url: `${fx.base}/file/30000000/b.bin?rate=15000000` });
    const r = await reach(t, id, 'saving', 30000);
    const ranged = requests(t, '/file/30000000/b.bin').filter((l) => l.range && l.range !== 'bytes=0-0').slice(0, 3);
    const spans = ranged.map((l) => /bytes=(\d+)-(\d*)/.exec(l.range).slice(1).map((n) => (n === '' ? 29999999 : Number(n)))).sort((x, y) => x[0] - y[0]);
    const disjoint = spans.every(([, end], i) => i === spans.length - 1 || end < spans[i + 1][0]);
    const together = ranged.at(-1).t - ranged[0].t < 1000;
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: three parts make three disjoint ranged requests that overlap in time, and the file verifies', ranged.length === 3 && disjoint && together && r.parts.length >= 3 && part.size === 30000000 && part.ok, json({ ranged, spans, parts: r.parts.length, part }));
    await consistent('three parts');
  });

  await attempt('429', async () => {
    await fresh({ parts: 4 });
    const id = await add(t, { url: `${fx.base}/limited/30000000/c.bin?max=2` });
    await reach(t, id, 'saving', 40000);
    const caps = await readMeta(t, 'hostCaps');
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: four parts against a server that allows two finish, after at least one 429, and the host cap is at most 2', t.fx.log.some((l) => l.status === 429) && caps?.localhost?.cap <= 2 && part.ok, json({ caps, part, n429: t.fx.log.filter((l) => l.status === 429).length }));
    await consistent('429');
  });

  await attempt('pause and resume', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/40000000/d.bin?rate=8000000` });
    await progress(t, id);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [id] });
    const paused = await reach(t, id, 'paused');
    const saved = done(paused);
    await sendMsg(t, { type: 'dl-do', op: 'resume', ids: [id] });
    await reach(t, id, 'saving', 30000);
    const resumed = requests(t, '/file/40000000/d.bin').filter((l) => l.range && l.range !== 'bytes=0-0').at(-1);
    const from = Number(/bytes=(\d+)-/.exec(resumed?.range ?? '')?.[1]);
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: pause keeps the progress, and resume asks for exactly the persisted offset', saved > 0 && from === saved && part.size === 40000000 && part.ok, json({ saved, from, part }));
    await consistent('pause and resume');
  });

  await attempt('the engine document dies', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/40000000/k.bin?rate=8000000` });
    const before = await progress(t, id);
    await closeEngine(t);
    await wake(t);
    const r = await reach(t, id, 'saving', 30000);
    const reqs = requests(t, '/file/40000000/k.bin').filter((l) => l.range && l.range !== 'bytes=0-0');
    const from = Number(/bytes=(\d+)-/.exec(reqs.at(-1).range)?.[1]);
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: a download continues after the engine document closes, from a saved offset above 0', reqs.length >= 2 && from > 0 && from >= done(before) && part.size === 40000000 && part.ok && r.parts.every((p) => p.done === p.end - p.start + 1), json({ from, saved: done(before), part, reqs: reqs.map((l) => l.range) }));
    await consistent('engine dies');
  });

  await attempt('the part file is lost', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/40000000/m.bin?rate=8000000` });
    await progress(t, id);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [id] });
    const paused = await reach(t, id, 'paused');
    await deletePart(t, `${id}.part`);
    await sendMsg(t, { type: 'dl-do', op: 'resume', ids: [id] });
    const r = await reach(t, id, 'saving', 30000);
    const from = Number(/bytes=(\d+)-/.exec(requests(t, '/file/40000000/m.bin').filter((l) => l.range && l.range !== 'bytes=0-0').at(-1)?.range ?? '')?.[1]);
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: a resume after the part file was deleted restarts at byte 0 and the file has no holes', done(paused) > 0 && from === 0 && part.size === 40000000 && part.ok && r.parts.every((p) => p.done === p.end - p.start + 1), json({ saved: done(paused), from, part }));
    await consistent('part file lost');
  });

  await attempt('the part file is lost, three parts', async () => {
    // Parts beyond byte 0 write past the end of the empty file: the real file system must zero-fill below them.
    await fresh({ parts: 3 });
    const url = '/file/30000000/n.bin?rate=6000000';
    const id = await add(t, { url: `${fx.base}${url}` });
    await progress(t, id);
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [id] });
    const paused = await reach(t, id, 'paused');
    await deletePart(t, `${id}.part`);
    const before = requests(t, '/file/30000000/n.bin').length;
    await sendMsg(t, { type: 'dl-do', op: 'resume', ids: [id] });
    const r = await reach(t, id, 'saving', 40000);
    const starts = requests(t, '/file/30000000/n.bin').slice(before).filter((l) => l.range && l.range !== 'bytes=0-0').map((l) => Number(/bytes=(\d+)-/.exec(l.range)?.[1]));
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: three parts resumed after the part file was deleted restart every part and the file has no holes', done(paused) > 0 && starts.includes(0) && starts.every((x) => paused.parts.some((p) => p.start === x)) && part.size === 30000000 && part.ok && r.parts.every((p) => p.done === p.end - p.start + 1), json({ saved: done(paused), starts, parts: paused.parts.map((p) => [p.start, p.done]), part }));
    await consistent('part file lost, three parts');
  });

  await attempt('speed limit', async () => {
    await fresh({ speedLimit: { on: true, kbPerSecond: 2000 } });
    const id = await add(t, { url: `${fx.base}/file/10000000/h.bin` });
    const r = await reach(t, id, 'saving', 30000);
    const took = Date.now() - r.startedAt;
    check('downloads: transfer: a 2000 KB/s limit makes 10 MB take between 4 and 7 seconds', took >= 4000 && took <= 7000, `took ${took} ms`);
    await consistent('speed limit');
  });

  await attempt('no range', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/20000000/e.bin?ranges=no&rate=8000000` });
    await progress(t, id);
    const first = requests(t, '/file/20000000/e.bin');
    await closeEngine(t);
    await wake(t);
    const r = await reach(t, id, 'saving', 30000);
    const all = requests(t, '/file/20000000/e.bin');
    const last = all.at(-1);
    const part = await readPart(t, `${id}.part`);
    check('downloads: transfer: a server without ranges is downloaded in one go and restarts at byte 0 after a kill', first.length === 2 && first[1].range === null && all.length === 3 && (last.range === null || last.range === 'bytes=0-') && r.rangeOk === false && part.size === 20000000 && part.ok, json({ first: first.map((l) => l.range), all: all.map((l) => l.range), rangeOk: r.rangeOk, part }));
    await consistent('no range');
  });

  await attempt('hard error', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/1000/f.bin?status=403` });
    const r = await reach(t, id, 'failed');
    check('downloads: transfer: a 403 fails at once with the status sentence', r.error === ERRORS.status(403) && requests(t, '/file/1000/f.bin').length === 1, json({ error: r.error, n: requests(t, '/file/1000/f.bin').length }));
    await consistent('hard error');
  });

  await attempt('a link the probe cannot read', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/file/5000000/z.bin?enc=gzip` });
    const r = await reach(t, id, 'failed', 30000);
    check('downloads: transfer: a gzip answer to a ranged request fails with the probe sentence after three requests', r.error === ERRORS.probe && requests(t, '/file/5000000/z.bin').length === 3, json({ error: r.error, n: requests(t, '/file/5000000/z.bin').length }));
    await consistent('gzip');
  });

  await attempt('a command right after the engine starts', async () => {
    await fresh();
    await wake(t);
    await closeEngine(t);
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ url: `${fx.base}/file/1000000/s.bin`, source: 'manual' }] });
    const stored = reply?.ids?.length === 1 ? await get(t, reply.ids[0]) : null;
    check('downloads: transfer: an add sent right after the document closed is answered and stored', reply?.ok === true && !!stored, json({ reply, stored: stored?.id }));
    await consistent('10c');
  });

  await attempt('changed file', async () => {
    await fresh();
    const id = await add(t, { url: `${fx.base}/flip/20000000/g.bin?rate=8000000` });
    await progress(t, id);
    await closeEngine(t);
    await wake(t);
    const r = await reach(t, id, 'failed', 30000);
    check('downloads: transfer: a file that changed while the engine was away fails with the changed sentence', r.error === ERRORS.changed, json(r.error));
    await consistent('changed file');
  });

  await states.close();
}
