import { readFileSync } from 'node:fs';
import { isDeepStrictEqual as same } from 'node:util';
import { DEFAULT_DOWNLOADS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { stopWorker } from '../harness.mjs';
import { engineCount, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 400);
const PERMISSIONS = ['alarms', 'contextMenus', 'declarativeNetRequest', 'declarativeNetRequestFeedback', 'downloads', 'offscreen', 'scripting', 'storage', 'unlimitedStorage', 'webNavigation'];
const closeEngine = (t) => t.sw.evaluate(() => chrome.offscreen.closeDocument());

export async function run(t) {
  const { check } = t;
  const manifest = JSON.parse(readFileSync(new URL('../../dist/manifest.json', import.meta.url), 'utf8'));
  check('downloads: the manifest has the ten permissions and still only the two content scripts of Phase 1', same(manifest.permissions, PERMISSIONS) && manifest.content_scripts.length === 2, json({ p: manifest.permissions, scripts: manifest.content_scripts.length }));

  await resetDl(t);
  check('downloads: no engine document exists at rest', (await engineCount(t)) === 0);

  const idle = await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
  await until(async () => (await engineCount(t)) === 1);
  check('downloads: a command creates the engine document on demand', same(idle, { ok: true }), json(idle));

  const first = await sendMsg(t, { type: 'dl-sw-ready' });
  check('downloads: the handshake replies the default settings', same(first, { settings: DEFAULT_DOWNLOADS }), json(first));
  await setDownloads(t, { parts: 3 });
  const second = await sendMsg(t, { type: 'dl-sw-ready' });
  check('downloads: the handshake reads storage afresh (parts: 3)', second?.settings?.parts === 3, json(second));

  await closeEngine(t);
  const added = await sendMsg(t, { type: 'dl-add', items: [{ url: 'http://127.0.0.1:9/never.bin', source: 'manual' }] });
  const stored = (await readRecords(t)).some((r) => r.id === added?.ids?.[0]);
  check('downloads: a command right after the document closed waits for the engine, succeeds, and the record exists', added?.ok === true && added.ids?.length === 1 && stored, json({ added, stored }));

  const proto = await Promise.race([sendMsg(t, { type: 'constructor' }).then(() => 'answered'), new Promise((r) => setTimeout(() => r('hung'), 3000))]);
  check('downloads: a message type that is only an Object property is ignored, not left hanging', proto === 'answered', proto);

  const config = await sendMsg(t, { type: 'dl-eng-config', settings: DEFAULT_DOWNLOADS });
  check('downloads: the engine hears dl-eng-config', same(config, { ok: true }), json(config));

  const status = await stopWorker(t.ctx);
  const alive = await engineCount(t);
  const woken = await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
  check('downloads: stopping the service worker leaves the engine running, and a message wakes the worker', status === 'stopped' && alive === 1 && same(woken, { ok: true }), json({ status, alive, woken }));

  await closeEngine(t);
  const closed = await engineCount(t);
  const again = await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [] });
  check('downloads: a closed engine is created again by the next command', closed === 0 && same(again, { ok: true }) && (await engineCount(t)) === 1, json({ closed, again }));

  await resetDl(t);
  const bad = [{ url: 'ftp://x/y', source: 'manual' }, { url: 'https://x.test/y', source: 'manual', category: 'nope' }, { url: 'https://x.test/y', source: 'takeover' }];
  const replies = [];
  for (const item of bad) replies.push(await sendMsg(t, { type: 'dl-add', items: [item] }));
  check('downloads: a bad dl-add is refused and creates no engine', replies.every((r) => r?.ok === false && typeof r.message === 'string') && (await engineCount(t)) === 0, json({ replies, engines: await engineCount(t) }));
}
