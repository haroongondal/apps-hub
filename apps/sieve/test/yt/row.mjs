import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROW_ORDER } from '../../../../packages/sieve-core/src/yt-actions.ts';
import { DARK_ATTR, NAV, RELATED_LINK, SEL } from '../../src/yt/selectors.ts';
import { navigate, openYt, row, rowButton, setYouTube, until } from './helpers.mjs';

const COG = 'More and settings';
const ROW_MARK = 'sieve-yt-row'; // row.ts marks the row's first insertion (it imports CSS, so node cannot import it)
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
const barIds = (page) => page.evaluate(() => [...document.querySelector('sieve-yt-row').shadowRoot.querySelector('.bar').children].map((el) => el.dataset.id));
const inRowOrder = (ids) => ids.every((id, i) => i === 0 || ROW_ORDER.indexOf(ids[i - 1]) < ROW_ORDER.indexOf(id));

// The open popover's box against the viewport (below the fixed masthead when there is one), and whether its first control is the topmost element at its centre.
const popBox = (page) =>
  page.evaluate((masthead) => {
    const shadow = document.querySelector('sieve-yt-row').shadowRoot;
    const pop = shadow.querySelector('.pop');
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    const first = pop.querySelector('button:not([hidden]), input');
    const f = first.getBoundingClientRect();
    const hit = shadow.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2);
    const top = document.querySelector(masthead)?.getBoundingClientRect().bottom ?? 0;
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, top, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, firstVisible: !!hit && (hit === first || first.contains(hit) || hit.contains(first)), scrolls: pop.scrollHeight > pop.clientHeight };
  }, SEL.masthead);
const inside = (b) => !!b && b.x >= 0 && b.right <= b.vw && b.y >= b.top && b.bottom <= b.vh && b.firstVisible;

// row.ts bundled on its own into a blank page with a stub `chrome`, to register buttons in an order the extension's imports never use.
async function lateAdd(t, ids) {
  const { build } = await import('esbuild');
  const entry = `import { addButton, rowElement } from './row.ts';
for (const id of ${json(ids)}) addButton({ id, label: id, onClick() {} });
window.__order = [...rowElement('settings').closest('.bar').children].map((el) => el.dataset.id);`;
  const { outputFiles } = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL('../../src/yt/', import.meta.url)), loader: 'ts' }, bundle: true, format: 'iife', write: false, loader: { '.css': 'text' }, logLevel: 'silent' });
  const page = await t.ctx.newPage();
  try {
    await page.setContent('<!doctype html><body></body>');
    // The page's own `window.chrome` cannot be redefined, so the stub is a parameter the bundle's free `chrome` resolves to.
    const stub = '{ storage: { onChanged: { addListener() {} } }, runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} } }';
    await page.addScriptTag({ content: `((chrome) => {\n${outputFiles[0].text}\n})(${stub});` });
    return await page.evaluate(() => window.__order);
  } finally {
    await page.close();
  }
}

export async function local(t) {
  const { check } = t;
  let page;
  try {
    page = await openYt(t, '/watch?v=sieveTest01');
    check('row: the row appears before the anchor within 2 s', await until(() => placed(page), 2000));
    check('row: it has one button named "More and settings"', (await rowButton(page, COG).count()) === 1);
    const ids = await barIds(page);
    const expected = ['loop', 'speed-down', 'speed', 'speed-up', 'cinema', 'expand', 'filters', 'flip', 'settings'];
    check('row: every registered button is in the bar in ROW_ORDER order', expected.every((id) => ids.includes(id)) && inRowOrder(ids), json(ids));
    const late = await lateAdd(t, ['flip', 'loop', 'cinema', 'speed-up', 'boost']);
    check('row: buttons registered out of order (a late one too) land in ROW_ORDER order', json(late) === json(['loop', 'speed-up', 'boost', 'cinema', 'flip', 'settings']), json(late));
    check('row: the cog says it opens a menu (aria-haspopup="true")', (await rowButton(page, COG).getAttribute('aria-haspopup')) === 'true');

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
    const vt = () => page.evaluate(() => { const b = document.querySelector('#below'); return { inline: b.style.getPropertyValue('view-transition-name'), computed: getComputedStyle(b).viewTransitionName }; });
    await rowButton(page, COG).click();
    const vtOpen = await vt();
    await page.keyboard.press('Escape');
    const vtClosed = await vt();
    check('row: #below loses its view-transition-name while a popover is open and gets it back when it closes', json({ vtOpen, vtClosed }) === json({ vtOpen: { inline: 'none', computed: 'none' }, vtClosed: { inline: '', computed: 'metadata' } }), json({ vtOpen, vtClosed }));
    await rowButton(page, COG).click();
    await page.mouse.click(5, 300);
    check('row: a click outside closes the menu', !(await menuOpen(page)));
    await rowButton(page, COG).click();
    await rowButton(page, COG).click();
    check('row: a second click on the cog closes the menu', !(await menuOpen(page)));
    await rowButton(page, COG).click();
    await navigate(page, 'sieveTest02');
    check('row: an in-app navigation closes the open menu', !(await menuOpen(page)));

    // Fit: a narrow window (the cog's menu would run off the right), Filters options with the row at the bottom, and a short window.
    await page.setViewportSize({ width: 700, height: 720 });
    await rowButton(page, COG).click();
    const narrow = await popBox(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => document.querySelector('sieve-yt-row').scrollIntoView({ block: 'end' }));
    await row(page).getByRole('button', { name: 'Filter options' }).click();
    const low = await popBox(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.evaluate(() => document.querySelector('sieve-yt-row').scrollIntoView({ block: 'center' }));
    await row(page).getByRole('button', { name: 'Filter options' }).click();
    const short = await popBox(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 300, height: 720 });
    await row(page).getByRole('button', { name: 'Filter options' }).click();
    const thin = await popBox(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 720 });
    check('row: in a 700 px wide window the cog menu is inside the viewport with its first item visible', inside(narrow), json(narrow));
    check('row: Filters options opened at the bottom of the window stays inside the viewport', inside(low), json(low));
    check('row: in a 400 px tall window Filters options stays inside the viewport and scrolls inside', inside(short) && short.scrolls, json(short));
    check('row: in a 300 px wide window Filters options (300 px wide) narrows to stay inside the viewport', inside(thin), json(thin));

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
  // The page loaded before the earlier modules' live checks ran, so the row's own mark times it from navigation start.
  const shown = await until(() => placed(page), 5000);
  const at = await page.evaluate((m) => performance.getEntriesByName(m)[0]?.startTime ?? null, ROW_MARK);
  const appeared = shown && at !== null && at <= 5000;
  check('live row: the row appears under the player within 5 s of navigation', appeared, json({ shown, at }));
  if (!appeared) return;
  const under = await page.evaluate((p) => document.querySelector('sieve-yt-row').getBoundingClientRect().top >= document.querySelector(p).getBoundingClientRect().bottom - 1, SEL.player);
  check('live row: the row is below the player', under);
  if (!under) return;
  await watchRow(page, SEL.rowAnchor);
  await page.evaluate((a) => (window.__parent = document.querySelector(a).parentElement), SEL.rowAnchor);
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
  console.log(`live row: the anchor's parent is the same element after the navigations: ${await page.evaluate((a) => document.querySelector(a)?.parentElement === window.__parent, SEL.rowAnchor)}`);
  check('live row: 5 related-video navigations keep the same element, data-mounts 1 and 0 removals', navs.length === 5 && navs.every((n) => n.ok === true && n.same && n.mounts === '1' && n.removed === 0), json(navs));
  check('live row: the row height stayed above 0 in every animation frame', navs.every((n) => n.minHeight > 0), json(navs.map((n) => n.minHeight)));
  await page.evaluate((a) => document.querySelector(a).scrollIntoView({ block: 'center' }), SEL.rowAnchor);
  const box = await row(page).boundingBox();
  await rowButton(page, COG).click();
  const menu = await popBox(page);
  check('live row: the cog menu opens inside the viewport with its first item visible', inside(menu), json(menu));
  if (box) await page.screenshot({ path: join(t.shots, 'yt-row-live.png'), clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 120), width: Math.min(1280, box.width + 32), height: 320 } });
  await page.keyboard.press('Escape');
  console.log(`live row screenshot: ${join(t.shots, 'yt-row-live.png')}`);
}
