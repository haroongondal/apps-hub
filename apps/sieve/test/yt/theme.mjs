// Task 2.13: dark theme, accent colour and my CSS. The fixture's rules are the ones recorded in src/yt/theme.ts.
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { DARK_ATTR } from '../../src/yt/selectors.ts';
import { openYt, setYouTube, until } from './helpers.mjs';

const json = JSON.stringify;
const BLUE = 'rgb(30, 136, 229)';
const style = (page, prop, sel = '#bar', pseudo = null) => page.evaluate(([s, p, ps]) => getComputedStyle(document.querySelector(s), ps)[p], [sel, prop, pseudo]);
// color-mix() comes back as color(srgb 0.09 0.43 0.72); a plain colour as rgb(r, g, b).
const channels = (c) => (c.startsWith('color(') ? c.match(/[\d.]+/g).slice(-3).map((v) => Math.round(v * 255)) : c.match(/\d+/g).slice(0, 3).map(Number));
const isDark = (page) => page.evaluate((a) => document.documentElement.hasAttribute(a), DARK_ATTR);
const reset = (t) => t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
const open = (t, path = '/watch?v=sieveTest01') => openYt(t, path, 'theme');
const gradient = async (page) => (await style(page, 'backgroundImage')).includes('linear-gradient') && (await style(page, 'backgroundColor')) === 'rgba(0, 0, 0, 0)';
const styleText = (page, id) => page.evaluate((i) => document.querySelector(`style[data-sieve="${i}"]`)?.textContent ?? null, id);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { theme: { dark: true } });
    // A throwaway load first warms the renderer and the storage connection: the first load of a cold browser can ask for its settings later than the first frame.
    await (await open(t)).close();
    page = await open(t);
    const first = await until(() => page.evaluate(() => window.__first));
    check('theme: with "Dark theme" stored, <html> has the dark attribute in the first animation frame', first?.dark === true, `${json(first)} (applied is the sieve-yt-applied mark time in ms; null means no settings had arrived by the first frame)`);
    check('theme: the page is dark (background rgb(15, 15, 15))', (await style(page, 'backgroundColor', 'html')) === 'rgb(15, 15, 15)');
    await setYouTube(t, { theme: { dark: false } });
    check('theme: turning it off removes the attribute it added', await until(async () => !(await isDark(page))));
    await setYouTube(t, { theme: { dark: true } });
    check('theme: turning it on again adds it, without a reload', await until(() => isDark(page)));
    await page.close();

    for (const path of ['/live_chat?v=sieveTest01', '/embed/sieveTest01', '/shorts/sieveTest01', '/feed/subscriptions']) {
      page = await open(t, path);
      check(`theme: dark applies on ${path.split('?')[0]}`, await until(() => isDark(page)));
      await page.close();
    }

    page = await openYt(t, '/watch?v=sieveTest01&dark=1', 'theme');
    check('theme: a page that is dark already keeps its attribute when the switch is on', await isDark(page));
    await setYouTube(t, { theme: { dark: false } });
    await sleep(400);
    check('theme: and when the switch is turned off (Sieve removes only what it added)', await isDark(page));
    await page.close();
    await reset(t);

    await setYouTube(t, { theme: { accent: 'blue' } });
    page = await open(t);
    check('theme: accent blue gives the progress bar a background of rgb(30, 136, 229)', await until(async () => (await style(page, 'backgroundColor')) === BLUE), await style(page, 'backgroundColor'));
    check('theme: it colours the scrubber (through the brand-red variable) too', (await style(page, 'backgroundColor', '#scrubber')) === BLUE, await style(page, 'backgroundColor', '#scrubber'));
    const buffer = await style(page, 'backgroundColor', '#buffer');
    check('theme: the live buffer bar gets a darker shade of the accent, not the accent and not YouTube\'s red', json(channels(buffer)) === '[24,109,183]', buffer);
    check('theme: and the live badge dot', (await style(page, 'backgroundColor', '#badge', '::before')) === BLUE, await style(page, 'backgroundColor', '#badge', '::before'));
    await setYouTube(t, { theme: { accent: 'green' } });
    check('theme: changing the accent applies at once, without a reload', await until(async () => (await style(page, 'backgroundColor')) === 'rgb(67, 160, 71)'), await style(page, 'backgroundColor'));
    await setYouTube(t, { theme: { accent: 'youtube' } });
    check('theme: "YouTube red" writes nothing: the bar has YouTube\'s own gradient and the style is empty', (await until(async () => (await styleText(page, 'accent')) === '')) && (await gradient(page)), json(await styleText(page, 'accent')));
    await page.close();

    await setYouTube(t, { theme: { accent: 'blue' } });
    page = await open(t, '/watch?v=sieveTest01&ad=1');
    await until(() => styleText(page, 'accent'));
    check('theme: an ad keeps YouTube\'s yellow bar (the accent does not override YouTube\'s own state colours)', (await style(page, 'backgroundColor')) === 'rgb(255, 204, 0)', await style(page, 'backgroundColor'));
    await page.close();
    await reset(t);

    await setYouTube(t, { theme: { css: 'body { outline: 3px solid rgb(1, 2, 3) }' } });
    page = await open(t);
    check('theme: my CSS gives the body an outline of rgb(1, 2, 3)', await until(async () => (await style(page, 'outlineColor', 'body')) === 'rgb(1, 2, 3)'), await style(page, 'outlineColor', 'body'));
    await setYouTube(t, { theme: { css: '.page-rule { background: rgb(9, 9, 9) }' } });
    await sleep(300);
    // Not a check: a limit, logged. `setStyle` appends to <html> once the first settings arrive, so My CSS lands after <head>'s styles; the logged value says whether it beats a page rule of equal specificity (observed: My CSS wins, rgb(9, 9, 9)).
    console.log(`theme limit: a page rule of equal specificity vs My CSS: ${await style(page, 'backgroundColor', '#pagerule')} (rgb(9, 9, 9) would mean My CSS wins, rgb(7, 7, 7) the page)`);
    await setYouTube(t, { theme: { accent: 'blue', css: 'html .ytp-play-progress { background: rgb(9, 9, 9) }' } });
    check('theme: my CSS wins over the accent for a rule of equal specificity (html .ytp-play-progress, so only the order decides)', await until(async () => (await style(page, 'backgroundColor')) === 'rgb(9, 9, 9)'), await style(page, 'backgroundColor'));
    const order = await page.evaluate(() => [...document.querySelectorAll('style[data-sieve="accent"], style[data-sieve="my-css"]')].map((s) => s.dataset.sieve));
    check('theme: the accent style comes before my CSS style', json(order) === '["accent","my-css"]', json(order));
    await page.close();
    await reset(t);

    const evil = '</style><script>window.__pwned = 1</script>';
    await setYouTube(t, { theme: { css: evil } });
    page = await open(t);
    await until(() => styleText(page, 'my-css'));
    const inert = await page.evaluate(() => ({ pwned: window.__pwned, text: document.querySelector('style[data-sieve="my-css"]')?.textContent, children: document.querySelector('style[data-sieve="my-css"]')?.childNodes.length }));
    check('theme: CSS with </style><script> leaves window.__pwned undefined and is the style element\'s text', inert.pwned === undefined && inert.text === evil && inert.children === 1, json(inert));
    await page.close();
    await reset(t);

    await setYouTube(t, { on: false, theme: { dark: true, accent: 'blue', css: 'body { outline: 3px solid rgb(1, 2, 3) }' } });
    page = await open(t);
    await sleep(600);
    const off = { dark: await isDark(page), gradient: await gradient(page), outline: await style(page, 'outlineStyle', 'body'), styles: await page.evaluate(() => [...document.querySelectorAll('style[data-sieve="accent"], style[data-sieve="my-css"]')].map((s) => s.textContent)) };
    check('theme: with YouTube tools off none of the three applies', !off.dark && off.gradient && off.outline === 'none' && off.styles.every((s) => s === ''), json(off));
    await setYouTube(t, { on: true });
    check('theme: turning YouTube tools on applies all three at once', (await until(() => isDark(page))) && (await until(async () => (await style(page, 'backgroundColor')) === BLUE)) && (await style(page, 'outlineColor', 'body')) === 'rgb(1, 2, 3)');
    await setYouTube(t, { on: false });
    check('theme: turning them off removes all three', (await until(async () => !(await isDark(page)))) && (await until(() => gradient(page))) && (await style(page, 'outlineStyle', 'body')) === 'none');
    await page.close();
  } finally {
    await page?.close().catch(() => {});
    await reset(t);
  }
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export async function live(t) {
  const { check, page } = t;
  try {
    await setYouTube(t, { theme: { dark: true, accent: 'blue' } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    // ytd-app is the element whose background the inspection recorded (rgb(255, 255, 255) light, rgb(15, 15, 15) dark).
    const bg = await until(() => page.evaluate(() => document.querySelector('ytd-app') && getComputedStyle(document.querySelector('ytd-app')).backgroundColor), 20_000);
    const dark = await page.evaluate((a) => document.documentElement.hasAttribute(a), DARK_ATTR);
    check('live theme: the real page is dark (background relative luminance below 0.1)', !!bg && dark && luminance(bg) < 0.1, json({ bg, dark }));
    const bar = await until(() => page.evaluate(() => document.querySelector('.ytp-play-progress') && getComputedStyle(document.querySelector('.ytp-play-progress')).backgroundColor), 20_000);
    check('live theme: accent blue colours the progress bar (rgb(30, 136, 229))', bar === BLUE, json(bar));
    const vars = await page.evaluate(() => ['--yt-sys-color-baseline--static-brand-red', '--yt-sys-color-baseline--overlay-background-brand'].map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()));
    console.log(`live theme variables: ${json(vars)}`);
    await sleep(1500);
    const path = join(t.shots, 'yt-theme.png');
    await page.screenshot({ path });
    console.log(`live theme screenshot: ${path}`);
  } finally {
    await reset(t);
  }
}
