// Task 2.17: the menu's YouTube tab. `popup.html?tab=<id>` stands in for the toolbar button, as in test/e2e.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { latestDownload, openYt, row, storedYouTube, until, ytCalls } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const tabIdOf = (t, page) => t.sw.evaluate(async (url) => (await chrome.tabs.query({})).find((x) => x.url === url)?.id, page.url());

async function openMenu(t, tabId, colorScheme = 'light') {
  const pop = await t.ctx.newPage();
  const problems = [];
  pop.on('pageerror', (e) => problems.push(e.message));
  pop.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  await pop.emulateMedia({ colorScheme });
  await pop.setViewportSize({ width: 340, height: 760 });
  await pop.goto(`chrome-extension://${t.id}/popup.html?tab=${tabId}`);
  await pop.locator('footer').waitFor();
  return { pop, problems };
}

const tabSelected = (pop, name) => pop.getByRole('tab', { name, exact: true }).getAttribute('aria-selected');
const speedText = (pop) => pop.locator('[data-id="speed-value"]').innerText();
const toggle = (pop, name) => pop.getByRole('switch', { name, exact: true });
const button = (pop, name) => pop.getByRole('button', { name, exact: true });
const qualityOf = (pop) => pop.getByLabel('Quality', { exact: true });

export async function local(t) {
  const { check } = t;
  let page;
  let m;
  try {
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => document.querySelector('#movie_player video')?.currentTime > 0.3));
    m = await openMenu(t, await tabIdOf(t, page));
    const { pop } = m;
    check('menu: a fixture watch tab opens the menu on "YouTube"', (await tabSelected(pop, 'YouTube')) === 'true' && (await tabSelected(pop, 'Blocking')) === 'false', `${await tabSelected(pop, 'YouTube')} ${await tabSelected(pop, 'Blocking')}`);
    check('menu: the speed reads "1×"', await until(async () => (await speedText(pop)) === '1×', 2000), await speedText(pop));
    const firstControl = await pop.evaluate(() => [...document.querySelectorAll('#app input, #app select, #app button, #app a')].filter((el) => !el.closest('header, nav'))[0]?.getAttribute('data-id'));
    check('menu: the first control of the tab is the "YouTube tools" switch, and it is on', firstControl === 'yt-on' && (await toggle(pop, 'YouTube tools').isChecked()), String(firstControl));
    check('menu: the "Slower" and "Faster" buttons are there', (await button(pop, 'Slower').count()) === 1 && (await button(pop, 'Faster').count()) === 1);
    check('menu: "Reverse playlist" is hidden without a playlist', !(await toggle(pop, 'Reverse playlist').isVisible()));
    check('menu: the footer link "YouTube settings" goes to options.html#youtube', (await pop.getByRole('link', { name: 'YouTube settings', exact: true }).getAttribute('href')) === 'options.html#youtube');

    const t0 = Date.now();
    await button(pop, 'Faster').click();
    const rate = await until(() => page.evaluate(() => document.querySelector('#movie_player video').playbackRate === 1.25), 500);
    const shown = await until(async () => (await speedText(pop)) === '1.25×', 500);
    check('menu: "Faster" gives the video 1.25 and the menu "1.25×" within 500 ms', rate && shown, `${rate} ${shown} ${await speedText(pop)} ${Date.now() - t0} ms`);
    await button(pop, 'Slower').click();
    check('menu: "Slower" goes back to 1', await until(async () => (await speedText(pop)) === '1×', 1000), await speedText(pop));

    const options = await qualityOf(pop).locator('option').allInnerTexts();
    check("menu: the quality select lists \"Auto\" and the fake player's levels as heights", json(options) === json(['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p']), json(options));
    await qualityOf(pop).selectOption('hd1080');
    await qualityOf(pop).selectOption('hd720');
    const calls = await until(async () => (await ytCalls(page, 'setPlaybackQualityRange')).length >= 2 && (await ytCalls(page, 'setPlaybackQualityRange')), 2000);
    check('menu: choosing 1080p then 720p makes the recorded setter calls (hd1080, hd1080) and (hd720, hd720)', json(calls?.map((c) => c.args)) === json([['hd1080', 'hd1080'], ['hd720', 'hd720']]), json(calls));

    await toggle(pop, 'Loop').click();
    check('menu: "Loop" gives video.loop === true', await until(() => page.evaluate(() => document.querySelector('#movie_player video').loop === true), 1000));
    await toggle(pop, 'Loop').click();
    check('menu: "Loop" again turns it off', await until(() => page.evaluate(() => document.querySelector('#movie_player video').loop === false), 1000));
    await toggle(pop, 'Cinema mode').click();
    check('menu: "Cinema mode" stores player.cinema === true and the switch stays on', (await until(async () => (await storedYouTube(t))?.player?.cinema === true, 2000)) && (await until(() => toggle(pop, 'Cinema mode').isChecked(), 1000)), json((await storedYouTube(t))?.player));
    await toggle(pop, 'Cinema mode').click();
    await until(async () => (await storedYouTube(t))?.player?.cinema === false, 2000);
    await toggle(pop, 'Flip horizontally').click();
    check('menu: "Flip horizontally" flips the video and the switch shows it', (await until(() => page.evaluate(() => getComputedStyle(document.querySelector('#movie_player video')).transform !== 'none'), 1000)) && (await until(() => toggle(pop, 'Flip horizontally').isChecked(), 1000)));
    await toggle(pop, 'Flip horizontally').click();

    // Task 2.9 owns the screenshot action; until yt-relay.ts imports it the click only reaches the page's main world.
    if (readFileSync(new URL('../../src/yt-relay.ts', import.meta.url), 'utf8').includes('./yt/capture.ts')) {
      const before = (await latestDownload(t))?.id ?? 0;
      await button(pop, 'Take a screenshot').click();
      check('menu: "Take a screenshot" makes a download', await until(async () => ((await latestDownload(t))?.id ?? 0) > before, 5000), json(await latestDownload(t)));
    } else console.log('SKIP  menu: "Take a screenshot" makes a download (yt-relay.ts does not import capture.ts of Task 2.9 yet)');
    await button(pop, 'Stop').click();
    check('menu: "Stop" makes the recorded stopVideo call', await until(async () => (await ytCalls(page, 'stopVideo')).length === 1, 2000), json(await ytCalls(page, 'stopVideo')));

    const held = await button(pop, 'Faster').elementHandle();
    await page.evaluate(() => (document.querySelector('#movie_player video').playbackRate = 1.5));
    await until(async () => (await speedText(pop)) === '1.5×', 1000);
    check('menu: a new snapshot updates the controls in place (the same "Faster" button stays in the page)', await held.evaluate((el) => el.isConnected));

    await toggle(pop, 'YouTube tools').click();
    const stored = await until(async () => (await storedYouTube(t))?.on === false && (await storedYouTube(t)), 2000);
    check('menu: turning "YouTube tools" off stores youtube.on === false', stored?.on === false, json(stored));
    const grey = await pop.evaluate(() => {
      const wrap = document.querySelector('[data-id="yt-controls"]');
      return { inert: wrap?.hasAttribute('inert'), opacity: wrap && getComputedStyle(wrap).opacity, count: wrap?.querySelectorAll('input, select, button').length };
    });
    check('menu: with the tools off the other controls are inert and greyed out, but still in the page', grey.inert === true && grey.opacity === '0.5' && grey.count > 8, json(grey));
    check('menu: with the tools off the fixture row is hidden', await until(async () => !(await row(page).isVisible()), 2000));
    const header = await pop.locator('header').getByRole('switch', { name: 'Sieve on', exact: true }).isChecked();
    const enabled = await t.sw.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings?.enabled));
    check('menu: the header "Sieve on" switch (blocking) is unchanged and stays in the header', header === true && enabled !== false, json({ header, enabled }));
    await toggle(pop, 'YouTube tools').click();
    await until(async () => (await storedYouTube(t))?.on === true, 2000);
    const back = await pop.evaluate(() => document.querySelector('[data-id="yt-controls"]').hasAttribute('inert'));
    check('menu: turning "YouTube tools" on again makes the controls live and shows the row', !back && (await until(() => row(page).isVisible(), 2000)));

    await pop.screenshot({ path: join(t.shots, 'menu-youtube-light.png'), fullPage: true });
    await pop.emulateMedia({ colorScheme: 'dark' });
    await sleep(400); // the buttons and switches fade between themes
    await pop.screenshot({ path: join(t.shots, 'menu-youtube-dark.png'), fullPage: true });
    check('menu: no page errors in the menu', m.problems.length === 0, m.problems.join(' | '));
    await pop.close();
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest03&list=PLsieve&index=3&autoplay=0');
    m = await openMenu(t, await tabIdOf(t, page));
    check('menu: on a playlist page "Reverse playlist" is shown', await until(() => toggle(m.pop, 'Reverse playlist').isVisible(), 3000));
    await toggle(m.pop, 'Reverse playlist').click();
    check('menu: "Reverse playlist" turns the reversal on', await until(() => toggle(m.pop, 'Reverse playlist').isChecked(), 2000));
    await m.pop.close();
    await page.close();
    page = null;

    const other = await t.ctx.newPage();
    await other.goto(`https://localhost:${t.servers.httpsPort}/ads.html`, { waitUntil: 'load' });
    m = await openMenu(t, await tabIdOf(t, other));
    check('menu: a page that is not YouTube opens on "Blocking"', (await tabSelected(m.pop, 'Blocking')) === 'true' && (await tabSelected(m.pop, 'YouTube')) === 'false');
    await m.pop.getByRole('tab', { name: 'YouTube', exact: true }).click();
    check('menu: its "YouTube" tab says "Open a YouTube video to use these tools." and shows no speed controls', (await m.pop.getByText('Open a YouTube video to use these tools.', { exact: true }).isVisible()) && (await button(m.pop, 'Faster').count()) === 0);
    await m.pop.getByRole('tab', { name: 'Blocking', exact: true }).click();
    check('menu: back on "Blocking" the blocking controls are there', await toggle(m.pop, 'Block on this site').isVisible());
    check('menu: no page errors on a page that is not YouTube', m.problems.length === 0, m.problems.join(' | '));
    await m.pop.close();
    await other.close();

    const mobile = await t.ctx.newPage();
    await mobile.goto(`https://m.youtube.com:${t.servers.httpsPort}/watch?v=sieveTest01&fixture=watch`, { waitUntil: 'load' });
    m = await openMenu(t, await tabIdOf(t, mobile));
    check('menu: m.youtube.com opens on "Blocking" with no console errors from the missing receiver', (await tabSelected(m.pop, 'Blocking')) === 'true' && m.problems.length === 0, m.problems.join(' | '));
    await m.pop.close();
    await mobile.close();
    m = null;
  } finally {
    await m?.pop.close().catch(() => {});
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

export async function live(t) {
  const { check, page } = t;
  const m = await openMenu(t, await tabIdOf(t, page));
  try {
    await until(async () => (await qualityOf(m.pop).locator('option').count()) > 1, 15_000);
    const options = await qualityOf(m.pop).locator('option').allInnerTexts();
    check('live menu: it opens on "YouTube" with a speed, "Auto" and real heights', (await tabSelected(m.pop, 'YouTube')) === 'true' && /^\d+(\.\d+)?×$/.test(await speedText(m.pop)) && options[0] === 'Auto' && options.length > 1 && options.slice(1).every((o) => /^\d+p$/.test(o)), json({ speed: await speedText(m.pop), options }));
    await button(m.pop, 'Faster').click();
    check("live menu: \"Faster\" changes the real video's rate", await until(() => page.evaluate(() => document.querySelector('#movie_player video').playbackRate > 1), 3000));
    await m.pop.screenshot({ path: join(t.shots, 'menu-youtube-live.png'), fullPage: true });
  } finally {
    await page.evaluate(() => (document.querySelector('#movie_player video').playbackRate = 1)).catch(() => {});
    await m.pop.close();
  }
}
