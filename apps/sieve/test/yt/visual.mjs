import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SEL } from '../../src/yt/selectors.ts';
import { navigate, row, setYouTube, storedYouTube, until } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const btn = (page, name) => row(page).getByRole('button', { name, exact: true });
const bg = (page) => page.evaluate(() => { const b = document.querySelector('sieve-yt-backdrop'); return b && getComputedStyle(b).backgroundColor; });
const shown = (page) => page.evaluate(() => { const b = document.querySelector('sieve-yt-backdrop'); return !!b && getComputedStyle(b).display !== 'none'; });
const videoCss = (page, prop) => page.evaluate(([sel, p]) => getComputedStyle(document.querySelector(sel))[p], [SEL.video, prop]);
const theater = (page) => page.evaluate((sel) => document.querySelector(sel).hasAttribute('theater'), SEL.watch);
const hit = (page) => page.evaluate((sel) => {
  const el = (x, y) => document.elementFromPoint(x, y);
  const r = document.querySelector(sel.player).getBoundingClientRect();
  const rr = document.querySelector('sieve-yt-row').getBoundingClientRect();
  return { corner: el(5, innerHeight - 5)?.localName, player: !!el(r.x + r.width / 2, r.y + r.height / 2)?.closest(sel.player), row: el(rr.x + 20, rr.y + rr.height / 2)?.localName };
}, SEL);

const present = (page) => page.evaluate(() => !!document.querySelector('sieve-yt-backdrop')?.isConnected);

const open = async (t, path = '/watch?v=sieveTest01', hold = false) => {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  await page.addInitScript(([sel, held]) => {
    window.__sizeClicks = 0;
    window.__resizes = 0;
    window.__resizesAfterTheater = 0;
    window.__theaterAt = null;
    document.addEventListener('click', (e) => { if (e.target?.closest?.(sel)) window.__sizeClicks++; }, true);
    window.addEventListener('resize', () => { window.__resizes++; if (window.__theaterAt !== null) window.__resizesAfterTheater++; });
    new MutationObserver(() => { if (window.__theaterAt === null && document.querySelector('ytd-watch-flexy')?.hasAttribute('theater')) window.__theaterAt = performance.now(); }).observe(document, { attributes: true, subtree: true, attributeFilter: ['theater'] });
    if (!held) return;
    const send = EventTarget.prototype.dispatchEvent;
    const queue = [];
    window.__hold = true;
    EventTarget.prototype.dispatchEvent = function (e) {
      if (window.__hold && e.type === 'yt-navigate-finish') return queue.push([this, e]) > 0;
      return send.call(this, e);
    };
    window.__release = () => { window.__hold = false; for (const [target, e] of queue.splice(0)) send.call(target, new CustomEvent(e.type, { bubbles: true, composed: true, detail: e.detail })); };
  }, [SEL.sizeButton, hold]);
  await page.goto(new URL(`${path}&fixture=watch`, t.base).href, { waitUntil: 'load' });
  await until(() => row(page).count());
  return page;
};

export async function local(t) {
  const { check } = t;
  const pages = [];
  const mk = async (...args) => pages[pages.push(await open(t, ...args)) - 1];
  try {
    await t.sw.evaluate(() => { globalThis.__ytWrites = 0; chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.youtube) globalThis.__ytWrites++; }); });

    await setYouTube(t, { player: { cinema: true } });
    let page = await mk();
    const want = json({ corner: 'sieve-yt-backdrop', player: true, row: 'sieve-yt-row' });
    check('visual cinema: the corner is the backdrop, and the player and the row stay above it', await until(async () => json(await hit(page)) === want), json(await hit(page)));
    check('visual cinema: the backdrop is rgba(0, 0, 0, 0.85) by default', (await bg(page)) === 'rgba(0, 0, 0, 0.85)', await bg(page));
    await page.screenshot({ path: join(t.shots, 'yt-cinema-local.png') });
    await page.mouse.click(5, (page.viewportSize()?.height ?? 720) - 5);
    check('visual cinema: a click on the backdrop stores player.cinema false', await until(async () => (await storedYouTube(t))?.player.cinema === false), json((await storedYouTube(t))?.player));
    check('visual cinema: the backdrop is then removed from the page', await until(async () => !(await present(page))));

    const second = await mk();
    await setYouTube(t, { player: { cinema: true, backdrop: '#336699', backdropOpacity: 50 } });
    check('visual cinema: backdrop #336699 at 50 is rgba(51, 102, 153, 0.5)', await until(async () => (await bg(page)) === 'rgba(51, 102, 153, 0.5)'), await bg(page));
    check('visual cinema: a second tab follows the stored change without a reload', await until(async () => (await bg(second)) === 'rgba(51, 102, 153, 0.5)' && (await shown(second))), await bg(second));
    await setYouTube(t, { player: { cinema: false } });
    check('visual cinema: and follows it off again, removing the backdrop', await until(async () => !(await present(second))));
    await btn(second, 'Cinema').click();
    check('visual cinema: the "Cinema" row button turns it on, pressed', (await until(async () => (await storedYouTube(t))?.player.cinema === true)) && (await until(async () => (await btn(second, 'Cinema').getAttribute('aria-pressed')) === 'true')));
    await setYouTube(t, { on: false });
    check('visual cinema: with YouTube tools off the backdrop is removed', await until(async () => !(await present(second))));
    await setYouTube(t, { on: true, player: { cinema: false, backdrop: '#000000', backdropOpacity: 85 } });
    await Promise.all(pages.splice(0).map((p) => p.close()));

    page = await mk();
    const facts = () => page.evaluate(([sel]) => ({ theater: document.querySelector(sel.watch).hasAttribute('theater'), box: Math.round(document.querySelector(sel.theaterBox).getBoundingClientRect().height), want: innerHeight - Math.round(document.querySelector(sel.masthead).getBoundingClientRect().height), resizes: window.__resizes }), [SEL]);
    await btn(page, 'Expand').click();
    check('visual expand: "Expand" sets theater, and the theater box is the viewport minus the masthead (+-1 px)', await until(async () => { const f = await facts(); return f.theater && Math.abs(f.box - f.want) <= 1; }), json(await facts()));
    check('visual expand: a resize event reached the window', await until(async () => (await facts()).resizes >= 1), json(await facts()));
    await page.screenshot({ path: join(t.shots, 'yt-expand-local.png') });
    await page.evaluate((sel) => document.querySelector(sel).setAttribute('fullscreen', ''), SEL.watch);
    check('visual expand: in full screen the override steps aside', await until(async () => (await facts()).box !== (await facts()).want), json(await facts()));
    await page.evaluate((sel) => document.querySelector(sel).removeAttribute('fullscreen'), SEL.watch);
    await btn(page, 'Flip').click();
    await setYouTube(t, { on: false });
    check('visual expand: with YouTube tools off the override is gone and so is the flip', await until(async () => (await facts()).box !== (await facts()).want && (await videoCss(page, 'transform')) === 'none'), json(await facts()));
    await setYouTube(t, { on: true });
    await setYouTube(t, { player: { expand: false } });
    check('visual expand: turning it off lets the box go back', await until(async () => { const f = await facts(); return Math.abs(f.box - f.want) > 1; }), json(await facts()));
    await page.close();
    pages.length = 0;

    await setYouTube(t, { player: { expand: true } });
    page = await mk();
    const late = () => page.evaluate(() => ({ theaterAt: window.__theaterAt, after: window.__resizesAfterTheater }));
    check('visual expand: a stored expand on a hard load sends a resize after the late theater click', await until(async () => (await late()).after >= 1), json(await late()));
    await page.close();
    pages.length = 0;
    await setYouTube(t, { player: { expand: false } });

    await setYouTube(t, { player: { autoTheater: true } });
    page = await mk('/watch?v=sieveTest01', true);
    await sleep(1000);
    const early = { theater: await theater(page), clicks: await page.evaluate(() => window.__sizeClicks) };
    check('visual theater: before yt-navigate-finish the size button is not clicked', !early.theater && early.clicks === 0, json(early));
    await page.evaluate(() => window.__release());
    check('visual theater: after yt-navigate-finish it is clicked once', (await until(() => theater(page))) && (await page.evaluate(() => window.__sizeClicks)) === 1);
    await page.close();
    pages.length = 0;
    await setYouTube(t, { player: { autoTheater: true } });
    page = await mk();
    check('visual theater: with auto theater a load gives theater', await until(() => theater(page)));
    await navigate(page, 'sieveTest02');
    await sleep(300);
    const auto = { theater: await theater(page), clicks: await page.evaluate(() => window.__sizeClicks) };
    check('visual theater: after navigate it is still theater, and the size button was clicked once', auto.theater && auto.clicks === 1, json(auto));
    await page.evaluate((sel) => document.querySelector(sel).click(), SEL.sizeButton);
    await navigate(page, 'sieveTest03');
    check('visual theater: after leaving theater by hand, the next video goes back to it', await until(() => theater(page)));
    await page.close();
    pages.length = 0;
    await setYouTube(t, { player: { autoTheater: false } });

    page = await mk();
    await btn(page, 'Flip').click();
    check('visual flip: "Flip" flips the video horizontally', await until(async () => (await videoCss(page, 'transform')) === 'matrix(-1, 0, 0, 1, 0, 0)'), await videoCss(page, 'transform'));
    await btn(page, 'Flip options').click();
    await row(page).getByRole('switch', { name: 'Flip vertically' }).click();
    check('visual flip: "Flip vertically" adds the vertical flip', await until(async () => (await videoCss(page, 'transform')) === 'matrix(-1, 0, 0, -1, 0, 0)'), await videoCss(page, 'transform'));
    await row(page).getByRole('switch', { name: 'Flip horizontally' }).click();
    check('visual flip: the "Flip horizontally" switch turns the horizontal flip off, leaving the vertical one', await until(async () => (await videoCss(page, 'transform')) === 'matrix(1, 0, 0, -1, 0, 0)'), await videoCss(page, 'transform'));
    check('visual flip: the Flip button stays pressed with only the vertical flip', await until(async () => (await btn(page, 'Flip').getAttribute('aria-pressed')) === 'true'));
    await navigate(page, 'sieveTest02');
    check('visual flip: a new video resets the flip', await until(async () => (await videoCss(page, 'transform')) === 'none'), await videoCss(page, 'transform'));
    check('visual flip: the stored settings never hold it', !('flip' in ((await storedYouTube(t))?.player ?? {})));
    await page.close();
    pages.length = 0;

    page = await mk();
    await btn(page, 'Filters').click();
    check('visual filters: "Filters" turns them on, with a computed filter of none', (await until(async () => (await storedYouTube(t))?.player.filtersOn === true)) && (await videoCss(page, 'filter')) === 'none');
    await btn(page, 'Filter options').click();
    const texts = await row(page).locator('output').allTextContents();
    check('visual filters: eight sliders show their values', (await row(page).getByRole('slider').count()) === 8 && json(texts) === json(['0 px', '100%', '100%', '0%', '0°', '0%', '100%', '0%']), json(texts));
    await t.sw.evaluate(() => { globalThis.__ytWrites = 0; });
    await row(page).getByRole('slider', { name: 'Blur', exact: true }).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    check('visual filters: three ArrowRight presses on Blur give blur(3px) at once', await until(async () => (await videoCss(page, 'filter')) === 'blur(3px)'), await videoCss(page, 'filter'));
    check('visual filters: the value shows after the slider', (await row(page).locator('output').first().textContent()) === '3 px');
    await until(async () => (await storedYouTube(t))?.player.filters.blur === 3);
    await sleep(500);
    const writes = await t.sw.evaluate(() => globalThis.__ytWrites);
    check('visual filters: the drag wrote youtube at most twice, and blur is stored as 3', writes >= 1 && writes <= 2 && (await storedYouTube(t)).player.filters.blur === 3, `${writes} writes`);
    await page.screenshot({ path: join(t.shots, 'yt-filters-local.png') });
    await t.sw.evaluate(() => { globalThis.__ytWrites = 0; });
    await row(page).getByRole('slider', { name: 'Blur', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    check('visual filters: a page that unloads sends the pending slider change at once (before the 150 ms wait)', await until(async () => (await storedYouTube(t))?.player.filters.blur === 4, 130), json((await storedYouTube(t))?.player.filters));
    await row(page).getByRole('button', { name: 'Reset', exact: true }).click();
    check('visual filters: "Reset" gives none and stores the defaults', (await until(async () => (await videoCss(page, 'filter')) === 'none')) && (await until(async () => (await storedYouTube(t))?.player.filters.blur === 0)), await videoCss(page, 'filter'));
    await setYouTube(t, { player: { filters: { hue: 90, brightness: 120 } } });
    check('visual filters: a stored change reaches the page (brightness 120 and hue 90)', await until(async () => (await videoCss(page, 'filter')) === 'brightness(1.2) hue-rotate(90deg)'), await videoCss(page, 'filter'));
    await setYouTube(t, { on: false });
    check('visual filters: with YouTube tools off the video has no filter', await until(async () => (await videoCss(page, 'filter')) === 'none'));
    await page.close();
    pages.length = 0;
  } finally {
    await Promise.all(pages.map((p) => p.close().catch(() => {})));
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

export async function live(t) {
  const { check, page } = t;
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((sel) => document.querySelector(sel.video)?.currentTime > 1, SEL, { timeout: 30_000 }).catch(() => {});
    const gate = await gated();
    if (gate) return console.log(`SKIP  visual live: ${gate}`);

    await setYouTube(t, { player: { cinema: true } });
    const ok = await until(async () => (await hit(page).catch(() => ({}))).corner === 'sieve-yt-backdrop', 10_000);
    const facts = await hit(page);
    check('live cinema: the corner is the backdrop and the player centre is inside the player', ok && facts.player, json(facts));
    check('live cinema: the row stays above the backdrop', facts.row === 'sieve-yt-row', json(facts));
    await page.screenshot({ path: join(t.shots, 'yt-cinema.png') });
    await setYouTube(t, { player: { cinema: false } });

    await setYouTube(t, { player: { expand: true } });
    const expand = () => page.evaluate(([sel]) => ({ theater: document.querySelector(sel.watch).hasAttribute('theater'), box: document.querySelector(sel.theaterBox).getBoundingClientRect().height, want: innerHeight - document.querySelector(sel.masthead).getBoundingClientRect().height }), [SEL]);
    check('live expand: the theater container is the viewport minus the masthead (+-2 px)', await until(async () => { const f = await expand(); return f.theater && Math.abs(f.box - f.want) <= 2; }, 10_000), json(await expand()));
    await page.screenshot({ path: join(t.shots, 'yt-expand.png') });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction((sel) => document.querySelector(sel.watch)?.hasAttribute('theater'), SEL, { timeout: 30_000 }).catch(() => {});
    const fit = () => page.evaluate((sel) => { const p = document.querySelector(sel.player).getBoundingClientRect(); const v = document.querySelector(sel.video).getBoundingClientRect(); return { box: [p.width, p.height].map(Math.round), video: [v.width, v.height].map(Math.round), want: Math.round(Math.min(p.height, (p.width * 9) / 16)) }; }, SEL);
    check('live expand: with expand stored, a hard load ends with the video filling its box (height within 3 px)', await until(async () => { const f = await fit(); return f.box[1] > 300 && Math.abs(f.video[1] - f.want) <= 3; }, 15_000), json(await fit()));

    await page.locator('.ytp-fullscreen-button').click({ timeout: 10_000 }).catch(() => {});
    if (await until(() => page.evaluate(() => document.fullscreenElement !== null), 5000)) {
      const full = () => page.evaluate(([sel]) => ({ box: Math.round(document.querySelector(sel.theaterBox).getBoundingClientRect().height), vh: innerHeight }), [SEL]);
      check('live expand: in full screen the theater container is the whole window, not the window minus the masthead', await until(async () => { const f = await full(); return Math.abs(f.box - f.vh) <= 2; }, 5000), json(await full()));
      await page.evaluate(() => document.exitFullscreen());
      await until(() => page.evaluate(() => document.fullscreenElement === null), 5000);
    } else console.log('SKIP  live expand in full screen: the page did not enter full screen');
    await setYouTube(t, { player: { expand: false } });

    await until(() => row(page).count(), 10_000);
    await btn(page, 'Flip').click();
    check('live flip: the real video is flipped', await until(async () => (await videoCss(page, 'transform')) === 'matrix(-1, 0, 0, 1, 0, 0)', 5000), await videoCss(page, 'transform'));
    await btn(page, 'Flip').click();
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube')).catch(() => {});
  }
}
