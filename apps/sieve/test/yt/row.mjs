import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DARK_ATTR, NAV, RELATED_LINK, SEL } from '../../src/yt/selectors.ts';
import { navigate, openYt, row, rowButton, setYouTube, until } from './helpers.mjs';

const COG = 'More and settings';
const json = (v) => JSON.stringify(v);
const placed = (page) => page.evaluate((a) => { const h = document.querySelector('sieve-yt-row'); return !!h && document.querySelector(a)?.previousElementSibling === h; }, SEL.rowAnchor);
const same = (page) => page.evaluate(() => window.__row === document.querySelector('sieve-yt-row'));
const menuOpen = (page) => page.evaluate(() => !!document.querySelector('sieve-yt-row')?.shadowRoot.querySelector('[role="menu"]')?.isConnected);

const watchRow = (page, anchor) =>
  page.evaluate((a) => {
    const host = (window.__row = document.querySelector('sieve-yt-row'));
    window.__shadow = host.shadowRoot;
    window.__removed = 0;
    window.__minHeight = Infinity;
    window.__frames = 0;
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n === host) window.__removed++; }).observe(document.querySelector(a).parentElement, { childList: true });
    const sample = () => {
      // Only frames while the watch page shows: on home the whole watch root is hidden, row included.
      if (!document.querySelector('ytd-watch-flexy')?.hidden) window.__minHeight = Math.min(window.__minHeight, host.getBoundingClientRect().height);
      window.__frames++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, anchor);
const rowFacts = (page) => page.evaluate(() => ({ same: window.__row === document.querySelector('sieve-yt-row'), mounts: window.__row.dataset.mounts, removed: window.__removed, minHeight: window.__minHeight, frames: window.__frames }));

export async function local(t) {
  const { check } = t;
  let page;
  try {
    page = await openYt(t, '/watch?v=sieveTest01');
    check('row: the row appears before the anchor within 2 s', await until(() => placed(page), 2000));
    check('row: it has one button named "More and settings"', (await rowButton(page, COG).count()) === 1);

    await watchRow(page, SEL.rowAnchor);
    const navs = [];
    for (const id of ['sieveTest02', 'sieveTest03', 'sieveTest04', 'sieveTest05', 'sieveTest01']) {
      await navigate(page, id);
      await sleep(100);
      navs.push(await rowFacts(page));
    }
    check('row: 5 navigations keep the same element, data-mounts 1 and 0 removals', navs.every((n) => n.same && n.mounts === '1' && n.removed === 0), json(navs));
    check('row: its height never hit 0 in any animation frame during the navigations', navs.every((n) => n.minHeight > 0) && navs.at(-1).frames > 0, json(navs));

    const back = await page.evaluate((a) => new Promise((resolve) => {
      const start = performance.now();
      window.__rerenderBelow();
      const poll = () => (document.querySelector(a)?.previousElementSibling === window.__row ? resolve(performance.now() - start) : performance.now() - start > 1000 ? resolve(null) : setTimeout(poll, 5));
      poll();
    }), SEL.rowAnchor);
    const after = await page.evaluate(() => ({ same: window.__row === document.querySelector('sieve-yt-row'), shadow: window.__row.shadowRoot === window.__shadow, mounts: window.__row.dataset.mounts }));
    check('row: a re-render below the player puts the row back within 100 ms', back !== null && back <= 100, `${back} ms`);
    check('row: after the re-render it is the same element and shadow root, with data-mounts 2', after.same && after.shadow && after.mounts === '2', json(after));

    await navigate(page, 'home');
    await navigate(page, 'sieveTest03');
    check('row: watch to home and back shows the row again as the same element', (await until(() => placed(page), 2000)) && (await same(page)) && !(await page.evaluate(() => window.__row.hidden)));

    // The cog is the row's own icon button: it goes through addButton with `icon`, the path Task 2.9's picture-in-picture uses.
    const cog = await page.evaluate((name) => {
      const b = document.querySelector('sieve-yt-row').shadowRoot.querySelector(`button[aria-label="${name}"]`);
      return b && { svg: !!b.querySelector('svg'), text: b.textContent.trim(), title: b.title, last: !b.closest('.item').nextElementSibling };
    }, COG);
    check('row: an icon button renders an SVG, has no text label and keeps its aria-label (the cog)', cog?.svg && cog.text === '' && cog.title === COG, json(cog));
    check('row: the cog is the last button', cog?.last === true, json(cog));

    await page.evaluate(() => document.querySelector('sieve-yt-row').shadowRoot.querySelector('button').click());
    await sleep(200);
    check('row: a page script calling click() on a row button leaves the cog menu closed', !(await menuOpen(page)));

    await rowButton(page, COG).focus();
    await page.evaluate(() => (window.__keys.length = 0));
    await page.keyboard.press('k');
    check('row: with focus on the cog, pressing k reaches no page listener', (await page.evaluate(() => window.__keys.length)) === 0, json(await page.evaluate(() => window.__keys)));

    await rowButton(page, COG).click();
    const focusInMenu = await page.evaluate(() => document.querySelector('sieve-yt-row').shadowRoot.activeElement?.closest('[role="menu"]') !== null);
    check('row: a real click opens the cog menu and moves focus into it', (await menuOpen(page)) && focusInMenu);
    await page.keyboard.press('Escape');
    const escaped = await page.evaluate((name) => document.querySelector('sieve-yt-row').shadowRoot.activeElement?.getAttribute('aria-label') === name, COG);
    check('row: Esc closes the menu and focus returns to the cog', !(await menuOpen(page)) && escaped);
    await rowButton(page, COG).click();
    await page.mouse.click(5, 300);
    check('row: a click outside closes the menu', !(await menuOpen(page)));
    await rowButton(page, COG).click();
    await rowButton(page, COG).click();
    check('row: a second click on the cog closes the menu', !(await menuOpen(page)));

    const theme = () => page.evaluate(() => document.querySelector('sieve-yt-row').shadowRoot.querySelector('[data-brand="sieve"]')?.dataset.theme);
    const light = await theme();
    await page.evaluate((a) => document.documentElement.setAttribute(a, ''), DARK_ATTR);
    const dark = await until(async () => (await theme()) === 'dark', 1000);
    await page.evaluate((a) => document.documentElement.removeAttribute(a), DARK_ATTR);
    const lightAgain = await until(async () => (await theme()) === 'light', 1000);
    check('row: the wrapper theme follows the dark attribute on <html> (light, dark, light)', light === 'light' && dark && lightAgain, json({ light, dark, lightAgain }));

    await rowButton(page, COG).click();
    const opened = t.ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await row(page).getByRole('menuitem', { name: 'Sieve settings' }).click();
    const tab = await opened;
    if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
    check('row: cog then "Sieve settings" opens the YouTube section of the settings page', tab?.url() === `chrome-extension://${t.id}/options.html#youtube`, tab?.url() ?? 'no tab');
    await tab?.close();
    await page.close();

    await setYouTube(t, { on: false });
    page = await openYt(t, '/watch?v=sieveTest02');
    await sleep(1000);
    check('row: with YouTube tools off on a hard load there is no row host', (await row(page).count()) === 0);
    await setYouTube(t, { on: true });
    check('row: turning the tools on mounts the row', await until(() => placed(page), 2000));
    await page.evaluate(() => (window.__row = document.querySelector('sieve-yt-row')));
    await setYouTube(t, { on: false });
    const hidden = await until(() => page.evaluate(() => window.__row.hidden && window.__row === document.querySelector('sieve-yt-row')), 2000);
    await setYouTube(t, { on: true });
    const shown = await until(() => page.evaluate(() => !window.__row.hidden && window.__row === document.querySelector('sieve-yt-row')), 2000);
    check('row: turning the tools off hides that same host, and on again shows it', hidden && shown, json({ hidden, shown }));
    await page.close();

    const errorsBefore = t.errors.length;
    page = await openYt(t, '/watch?v=sieveTest03&noanchor=1');
    await sleep(1500);
    check('row: with no anchor there is no row and no page error', (await row(page).count()) === 0 && t.errors.length === errorsBefore, t.errors.slice(errorsBefore).join(' | '));
    await page.close();
    page = await openYt(t, '/watch?v=sieveTest04&state=unplayable');
    check('row: an unplayable video still gets the row, with no page error', (await until(() => placed(page), 2000)) && t.errors.length === errorsBefore, t.errors.slice(errorsBefore).join(' | '));
    await page.close();

    for (const [name, query] of [['yt-row-light', ''], ['yt-row-dark', '&dark=1']]) {
      page = await openYt(t, `/watch?v=sieveTest01${query}`);
      await until(() => placed(page), 2000);
      if (query) await page.evaluate(() => (document.body.style.background = '#0f0f0f'));
      await page.evaluate((a) => document.querySelector(a).scrollIntoView({ block: 'center' }), SEL.rowAnchor);
      await rowButton(page, COG).click();
      const box = await row(page).boundingBox();
      await page.screenshot({ path: join(t.shots, `${name}.png`), clip: { x: 0, y: Math.max(0, box.y - 60), width: 920, height: 260 } });
      await page.close();
    }
    page = null;
    console.log(`row screenshots: ${join(t.shots, 'yt-row-light.png')}, ${join(t.shots, 'yt-row-dark.png')}`);
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

export async function live(t) {
  const { check, page } = t;
  check('live row: the row appears under the player within 5 s', await until(() => placed(page), 5000));
  const under = await page.evaluate((p) => document.querySelector('sieve-yt-row').getBoundingClientRect().top >= document.querySelector(p).getBoundingClientRect().bottom - 1, SEL.player);
  check('live row: the row is below the player', under);
  await watchRow(page, SEL.rowAnchor);
  const navs = [];
  for (let i = 0; i < 5; i++) {
    const before = page.url();
    const ok = await page.evaluate(([link, nav, from]) => new Promise((resolve) => {
      const a = [...document.querySelectorAll(link)].find((x) => new URL(x.href).searchParams.get('v') !== new URL(from).searchParams.get('v'));
      if (!a) return resolve('no related link');
      const timer = setTimeout(() => resolve('NAV.finish did not fire in 15 s'), 15_000);
      (nav.target === 'window' ? window : document).addEventListener(nav.finish, () => { clearTimeout(timer); resolve(true); }, { once: true });
      a.click();
    }), [RELATED_LINK, NAV, before]);
    await sleep(1500);
    navs.push({ ok, url: page.url(), ...(await rowFacts(page)) });
    if (ok !== true) break;
  }
  console.log(`live row navigations: ${json(navs)}`);
  check('live row: 5 related-video navigations keep the same element, data-mounts 1 and 0 removals', navs.length === 5 && navs.every((n) => n.ok === true && n.same && n.mounts === '1' && n.removed === 0), json(navs));
  check('live row: the row height stayed above 0 in every animation frame', navs.every((n) => n.minHeight > 0), json(navs.map((n) => n.minHeight)));
  await page.evaluate((a) => document.querySelector(a).scrollIntoView({ block: 'center' }), SEL.rowAnchor);
  const box = await row(page).boundingBox();
  if (box) await page.screenshot({ path: join(t.shots, 'yt-row-live.png'), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 120), width: Math.min(1280, box.width + 32), height: 240 } });
  console.log(`live row screenshot: ${join(t.shots, 'yt-row-live.png')}`);
}
