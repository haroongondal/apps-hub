// Task 2.17 close minors: the page side of the menu's yt-menu port refuses forged or switched-off commands, and does not follow the header "Sieve on" switch.
import { setTimeout as sleep } from 'node:timers/promises';
import { openYt, setSettings, setYouTube, until, ytCalls } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const stops = (page) => ytCalls(page, 'stopVideo').then((c) => c.length);

// Opens the port from the worker, as the menu does, waits for the first snapshot, then posts each message in turn.
const post = (t, page, messages) =>
  t.sw.evaluate(async ([url, list]) => {
    const tab = (await chrome.tabs.query({})).find((x) => x.url === url);
    const port = chrome.tabs.connect(tab.id, { name: 'yt-menu', frameId: 0 });
    const first = await new Promise((resolve) => {
      port.onMessage.addListener(resolve);
      port.onDisconnect.addListener(() => resolve(null));
    });
    for (const m of list) port.postMessage(m);
    await new Promise((r) => setTimeout(r, 400));
    port.disconnect();
    return first?.type ?? null;
  }, [page.url(), messages]);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { on: true });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings ?? null));
    const errors = t.errors.length;

    const first = await post(t, page, [{ type: 'do', action: 'nope' }, { type: 'do', action: 42 }, { type: 'run', action: 'stop' }, null, 'stop']);
    check('menu port: forged messages (an unknown action, a number, another type, null, a bare string) run nothing and raise no page error', first === 'state' && (await stops(page)) === 0 && t.errors.length === errors, json({ first, stops: await stops(page), errors: t.errors.slice(errors) }));

    await post(t, page, [{ type: 'do', action: 'stop' }]);
    check('menu port: a real "do stop" runs Stop (the control for the checks around it)', await until(async () => (await stops(page)) === 1, 2000), String(await stops(page)));

    await setYouTube(t, { on: false });
    await until(async () => (await page.evaluate(() => window.__lastSieveSettings?.on)) === false);
    await post(t, page, [{ type: 'do', action: 'stop' }]);
    await sleep(300);
    check('menu port: with YouTube tools off a "do stop" sent anyway runs nothing', (await stops(page)) === 1, String(await stops(page)));

    await setYouTube(t, { on: true });
    await setSettings(t, { enabled: false });
    await until(async () => (await page.evaluate(() => window.__lastSieveSettings?.on)) === true);
    await post(t, page, [{ type: 'do', action: 'stop' }]);
    check('menu port: with the header "Sieve on" (blocking) off and YouTube tools on, "do stop" still runs', await until(async () => (await stops(page)) === 2, 2000), String(await stops(page)));
  } finally {
    await page?.close().catch(() => {});
    await setSettings(t, { enabled: true });
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}
