// Task 2.3: settings at document_start, the page bridge and the worker's yt-command, on the local fixture; the mark against first-paint live.
import { setTimeout as sleep } from 'node:timers/promises';
import { openYt, sendToTab, setSettings, setYouTube, storedYouTube, until } from './helpers.mjs';

const MARK = 'sieve-yt-applied';
const CORE = new URL('../../../../packages/sieve-core/src/', import.meta.url).href;
const lastSettings = (page) => page.evaluate(() => window.__lastSieveSettings ?? null);
const marks = (page) => page.evaluate((m) => performance.getEntriesByName(m).length, MARK);
const json = (v) => JSON.stringify(v);

async function settled(t, path) {
  const page = await openYt(t, path);
  await until(() => lastSettings(page));
  return page;
}

export async function local(t) {
  const { check } = t;
  const { DEFAULT_YOUTUBE } = await import(`${CORE}youtube-settings.ts`);
  const { mainSettings } = await import(`${CORE}yt-bridge.ts`);
  try {
    let page = await settled(t, '/watch?v=sieveTest01');
    check('bridge: the main world sees one sieve-yt-applied mark', (await marks(page)) === 1, String(await marks(page)));
    check('bridge: the page gets exactly the main settings, with on from youtube.on', json(await lastSettings(page)) === json(mainSettings(DEFAULT_YOUTUBE, true)), json(await lastSettings(page)));

    await setYouTube(t, { speed: { default: 1.5 } });
    check('bridge: a stored change reaches the page within 1 s, without a reload', await until(async () => (await lastSettings(page))?.speed.default === 1.5, 1000));
    check('bridge: a stored change adds no second mark', (await marks(page)) === 1);
    await page.reload({ waitUntil: 'load' });
    check('bridge: the change is still there after a reload', await until(async () => (await lastSettings(page))?.speed.default === 1.5));
    await page.close();

    await setYouTube(t, { on: false });
    page = await settled(t, '/watch?v=sieveTest02');
    check('bridge: with YouTube tools off the page gets on: false', (await lastSettings(page))?.on === false, json(await lastSettings(page)));
    await page.close();
    await setYouTube(t, { on: true });
    await setSettings(t, { enabled: false });
    page = await settled(t, '/watch?v=sieveTest03');
    check('bridge: with Sieve (blocking) off and YouTube tools on, on stays true', (await lastSettings(page))?.on === true, json(await lastSettings(page)));
    await page.close();
    await setSettings(t, { enabled: true });

    page = await settled(t, '/watch?v=sieveTest04');
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-default' });
    const sent = await until(() => page.evaluate(() => window.__sieveDo.length > 0 && window.__sieveDo));
    check('bridge: with YouTube tools on, the worker yt-command speed-default reaches the main world', json(sent) === json([{ action: 'speed-default' }]), json(sent));
    await setYouTube(t, { on: false });
    await until(async () => (await lastSettings(page))?.on === false);
    await page.evaluate(() => (window.__sieveDo.length = 0));
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-default' });
    await sleep(500);
    check('bridge: with YouTube tools off, yt-command does nothing', (await page.evaluate(() => window.__sieveDo.length)) === 0);
    await setYouTube(t, { on: true });
    await page.close();

    const errorsBefore = t.errors.length;
    page = await settled(t, '/watch?v=sieveTest05');
    const before = json(await storedYouTube(t));
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('sieve-yt-state', { detail: { title: 'x'.repeat(5000), rate: 'fast', qualities: 7 } }));
      for (let i = 0; i < 100; i++) document.dispatchEvent(new CustomEvent('sieve-yt-hello'));
    });
    await sleep(300);
    check('bridge: a forged state and 100 hellos give no page errors and leave storage unchanged', t.errors.length === errorsBefore && json(await storedYouTube(t)) === before, t.errors.slice(errorsBefore).join(' | '));
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('sieve-yt-do', { detail: { action: 'boost' } })));
    await sleep(300);
    check('bridge: a forged sieve-yt-do boost leaves storage unchanged', json(await storedYouTube(t)) === before);
    await sendToTab(t, page, { type: 'yt-command', action: 'nope' });
    await sleep(300);
    check('bridge: an unknown yt-command causes no page error', t.errors.length === errorsBefore, t.errors.slice(errorsBefore).join(' | '));
    const names = () => page.evaluate(() => [...new Set([...Object.keys(window), ...Object.getOwnPropertyNames(window)])]);
    const withTools = await names();
    await page.close();

    await setYouTube(t, { on: false });
    await setSettings(t, { enabled: false });
    page = await settled(t, '/watch?v=sieveTest05');
    const without = new Set(await names());
    await page.close();
    await setSettings(t, { enabled: true });
    await setYouTube(t, { on: true });
    const added = withTools.filter((n) => !without.has(n));
    check('bridge: YouTube tools on add no window names compared with everything off', added.length === 0, json(added));
    const sieveNames = withTools.filter((n) => /sieve/i.test(n) && !['__lastSieveSettings', '__sieveDo'].includes(n));
    check('bridge: the page has no sieve-named globals beyond the fixture recorders', sieveNames.length === 0, json(sieveNames));

    const host = await t.ctx.newPage();
    host.on('pageerror', (e) => t.errors.push(e.message));
    await host.goto(`https://localhost:${t.servers.httpsPort}/yt/embed-host.html`, { waitUntil: 'load' });
    const frame = await until(() => host.frames().find((f) => new URL(f.url()).hostname === 'www.youtube-nocookie.com'));
    const embedded = frame && (await until(() => frame.evaluate(() => window.__lastSieveSettings ?? null).catch(() => null)));
    check('bridge: the nocookie embed frame gets the settings', embedded?.on === true, json(embedded));
    await host.close();
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
    await setSettings(t, { enabled: true });
  }
}

// Decision 4: settings reach the page asynchronously. Three hard loads: the mark must come before first-paint on each.
export async function live(t) {
  const { ctx, check, videoId } = t;
  const loads = [];
  for (let i = 0; i < 3; i++) {
    const page = await ctx.newPage();
    try {
      await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const timing = await until(
        () => page.evaluate((m) => {
          const mark = performance.getEntriesByName(m);
          const paint = performance.getEntriesByName('first-paint')[0];
          return mark.length && paint ? { mark: mark[0].startTime, marks: mark.length, paint: paint.startTime } : null;
        }, MARK).catch(() => null),
        15_000,
      );
      const gate = await page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).catch(() => ({}));
      loads.push(gate.bot || gate.consent ? { skip: gate.bot ? 'bot check' : 'consent page' } : timing ?? { missing: true });
    } catch (e) {
      loads.push({ error: String(e?.message ?? e).split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  console.log(`live bridge first-paint timings (ms): ${json(loads)}`);
  if (loads.some((l) => l.skip)) return console.log(`SKIP  bridge live: ${loads.find((l) => l.skip).skip}`);
  check('live: on 3 hard loads the sieve-yt-applied mark comes before first-paint', loads.every((l) => l.mark < l.paint && l.marks === 1), json(loads));
}
