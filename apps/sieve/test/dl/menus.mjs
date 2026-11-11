import { readFileSync } from 'node:fs';
import { isDeepStrictEqual as same } from 'node:util';
import { extPage, resetDl, sendMsg, sessionGet, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);

export async function run(t) {
  if (!t.fx) return t.check('downloads: menus needs the fixture server', false);
  const { check, fx } = t;
  await resetDl(t);
  const hub = await extPage(t, 'options.html');
  // downloads.html is Task 3.15's: this module reads only the tab URLs and the stored prefill, never the page.
  // Playwright sees every tab's URL (chrome.tabs.query hides extension pages without the tabs permission).
  const listTabs = async () => t.ctx.pages().filter((p) => p.url().startsWith(`chrome-extension://${t.id}/downloads.html`));
  const closeListTabs = async () => {
    for (const p of await listTabs()) await p.close({ runBeforeUnload: false }).catch(() => {});
  };
  const prefill = async () => (await sessionGet(t, 'dlPrefill')).dlPrefill;
  const clear = async () => {
    await hub.evaluate(() => chrome.storage.session.remove('dlPrefill'));
    await closeListTabs();
  };

  const page = await t.ctx.newPage();
  const pageUrl = `${fx.base}/links`;
  await page.goto(pageUrl);
  const tabId = await hub.evaluate(async (u) => (await chrome.tabs.query({ url: u })).map((x) => x.id)[0], pageUrl);
  const origin = new URL(pageUrl).origin;
  const link = (n) => `${origin}/file/1000/l${n}.bin`;
  const click = (info) => sendMsg(t, { type: 'dl-menu-click', tabId, pageUrl, ...info });
  await clear();

  const hook = await sendMsg(t, { type: 'dl-menu-click', menuItemId: 'dl-link', linkUrl: link(1), pageUrl, tabId });
  check('downloads: menus: the test hook replies ok', same(hook, { ok: true }), json(hook));
  check('downloads: menus: Download link stores the link and the page as referrer', same(await prefill(), { urls: [link(1)], referrer: pageUrl }), json(await prefill()));
  const opened = await until(async () => (await listTabs()).length === 1, 5000).catch(() => false);
  check('downloads: menus: Download link opens one downloads.html#add tab', opened === true && (await listTabs())[0].url().endsWith('/downloads.html#add'), json(t.ctx.pages().map((p) => p.url())));

  await clear();
  await click({ menuItemId: 'dl-page' });
  const all = (await prefill())?.urls;
  check('downloads: menus: Download all links gives the five http links once each, in page order', same(all, [1, 2, 3, 4, 5].map(link)), json(all));

  await clear();
  await page.evaluate(() => {
    const [, a2, a3] = document.querySelectorAll('a');
    const range = document.createRange();
    range.setStartBefore(a2);
    range.setEndAfter(a3);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  const text = await page.evaluate(() => String(getSelection()));
  await click({ menuItemId: 'dl-selection', selectionText: text });
  const picked = (await prefill())?.urls;
  check('downloads: menus: Download selected links gives links 2 and 3', same(picked, [link(2), link(3)]), json({ picked, text }));

  await clear();
  await setDownloads(t, { on: false });
  const before = await prefill();
  await click({ menuItemId: 'dl-link', linkUrl: link(4) });
  await click({ menuItemId: 'dl-page' });
  await new Promise((r) => setTimeout(r, 300));
  check('downloads: menus: with downloads off a click stores nothing and opens no tab', before === undefined && (await prefill()) === undefined && (await listTabs()).length === 0, json({ before, after: await prefill(), tabs: await listTabs() }));
  await setDownloads(t, { on: true });

  const scripts = await t.sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const manifest = JSON.parse(readFileSync(new URL('../../dist/manifest.json', import.meta.url), 'utf8'));
  check('downloads: menus: no dl* content script is registered and the manifest keeps its two content scripts', !scripts.some((id) => id.startsWith('dl')) && manifest.content_scripts.length === 2, json({ scripts, n: manifest.content_scripts.length }));

  await clear();
  await page.close();
  await hub.close();
}
