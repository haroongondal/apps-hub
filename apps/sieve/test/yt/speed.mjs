// Task 2.5: speed. The fixture records player calls in window.__ytCalls; the rate is read from the video, as the module does.
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate, openYt, row, rowButton, sendToTab, setYouTube, until, ytCalls } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const rate = (page) => page.evaluate(() => document.querySelector('#movie_player video').playbackRate);
const rateIs = (page, want) => until(async () => (await rate(page)) === want);
const label = (page) => row(page).locator('[data-id="speed"] button').innerText();
const labelIs = (page, want) => until(async () => (await label(page)) === want);
const speedWidth = (page) => row(page).locator('[data-id="speed"] button').evaluate((el) => el.getBoundingClientRect().width);
const toastText = (page) => row(page).getByRole('status').innerText();
// Real YouTube showed no ratechange when a new video reset the rate (Task 2.5 inspection), though Chrome queues one between `emptied` and
// `loadstart`: swallow it before it reaches the page's and the module's listeners, so a stale rate shows as it would on the real page.
const quietReset = (page) => page.evaluate(() => {
  let quiet = false;
  window.addEventListener('emptied', () => { quiet = true; }, true);
  window.addEventListener('ratechange', (e) => { if (quiet) e.stopImmediatePropagation(); }, true);
  window.addEventListener('loadstart', () => { quiet = false; }, true);
});
// The full row wraps on the fixture's column, so a toast that clears changes its height and, at the page's bottom, moves the button from
// under the pointer: wait for the label and the toast to settle, then point at it again.
const overSpeed = async (page, want) => {
  await labelIs(page, want);
  await until(async () => (await toastText(page)) === '');
  await row(page).locator('[data-id="speed"] button').hover();
};
const settled = (page, key, value) => until(() => page.evaluate(([k, v]) => window.__lastSieveSettings?.speed[k] === v, [key, value]));

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { speed: { setDefault: true, default: 1.5 } });
    page = await openYt(t, '/watch?v=sieveTest01');
    check('speed: with a default of 1.5 the video plays at 1.5 after load', await rateIs(page, 1.5), String(await rate(page)));
    check('speed: the speed button reads "1.5×"', await labelIs(page, '1.5×'), await label(page));
    check('speed: with any speed on the rate goes on the video, not through the player', (await ytCalls(page, 'setPlaybackRate')).length === 0, json(await ytCalls(page, 'setPlaybackRate')));
    await navigate(page, 'sieveTest02');
    await sleep(500);
    check('speed: after an in-app navigation the new video plays at 1.5 and the button still reads "1.5×"', (await rate(page)) === 1.5 && (await labelIs(page, '1.5×')), String(await rate(page)));
    // Watch A, home, A again: YouTube stops the video on home, so the same video id is a new start and gets the default, not the speed it had.
    await page.evaluate(() => { document.querySelector('#movie_player video').playbackRate = 1.25; });
    await navigate(page, 'home');
    await navigate(page, 'sieveTest02');
    check('speed: watch, home, then the same video again plays at the default 1.5', await rateIs(page, 1.5), String(await rate(page)));
    // The live failure of 2026-11-17: YouTube gave the playing video a new source and Chrome's load put the rate back to 1.
    await page.evaluate(() => window.__swap());
    await sleep(300);
    check('speed: a new source for the same video keeps the default 1.5', (await rate(page)) === 1.5, String(await rate(page)));

    await rowButton(page, 'Faster').click();
    check('speed: Faster gives 1.75 and "1.75×"', (await rateIs(page, 1.75)) && (await labelIs(page, '1.75×')), `${await rate(page)} ${await label(page)}`);
    await sleep(300);
    check('speed: a row click shows no toast (the button shows the speed)', (await toastText(page)) === '', await toastText(page));
    check('speed: the speed button names the current speed and what a click does', (await row(page).locator('[data-id="speed"] button').getAttribute('aria-label')) === 'Speed 1.75×. Click for your default speed.');
    // A navigation that leaves the video playing (a `&t=` link to it, say), then a new source for it: the owner's choice stays.
    await navigate(page, 'sieveTest02', { keep: true });
    await page.evaluate(() => window.__swap());
    await sleep(300);
    check("speed: the owner's 1.75 stays across a navigation that keeps the video and a new source for it", (await rate(page)) === 1.75, String(await rate(page)));
    // The fixture now names another video with no new source, so only a forged loadstart could make it look like a new one.
    await navigate(page, 'sieveTest03', { keep: true });
    await page.evaluate(() => document.querySelector('#movie_player video').dispatchEvent(new Event('loadstart')));
    await sleep(300);
    check('speed: a forged loadstart from the page does not put the default on again', (await rate(page)) === 1.75, String(await rate(page)));

    await setYouTube(t, { speed: { anySpeed: false } });
    await settled(page, 'anySpeed', false);
    await rowButton(page, 'Faster').click();
    check('speed: with any speed off Faster goes to 2 through the player', (await rateIs(page, 2)) && json((await ytCalls(page, 'setPlaybackRate')).map((c) => c.args[0])) === '[2]', json(await ytCalls(page, 'setPlaybackRate')));
    await rowButton(page, 'Faster').click();
    await sleep(300);
    check('speed: with any speed off, at the top of the offered speeds Faster stays 2', (await rate(page)) === 2, String(await rate(page)));
    // A speed set above or below YouTube's list (any speed was on before) is never moved by Faster or Slower, nor snapped back into the list.
    const direct = (r) => page.evaluate((v) => { document.querySelector('#movie_player video').playbackRate = v; }, r);
    await direct(3);
    await rateIs(page, 3);
    await rowButton(page, 'Faster').click();
    await sleep(300);
    check('speed: with any speed off, Faster at 3 (above the list) leaves it at 3', (await rate(page)) === 3, String(await rate(page)));
    await direct(0.1);
    await rateIs(page, 0.1);
    await rowButton(page, 'Slower').click();
    await sleep(300);
    check('speed: with any speed off, Slower at 0.1 (below the list) leaves it at 0.1', (await rate(page)) === 0.1, String(await rate(page)));
    await direct(2);
    await rateIs(page, 2);
    await setYouTube(t, { speed: { anySpeed: true } });
    await settled(page, 'anySpeed', true);
    await rowButton(page, 'Faster').click();
    check('speed: with any speed on, 2 then Faster gives 2.25', (await rateIs(page, 2.25)) && (await labelIs(page, '2.25×')), `${await rate(page)} ${await label(page)}`);
    await rowButton(page, 'Slower').click();
    check('speed: Slower goes back to 2', await rateIs(page, 2), String(await rate(page)));
    await row(page).locator('[data-id="speed"] button').click();
    check('speed: clicking the speed button goes to the default (1.5)', await rateIs(page, 1.5), String(await rate(page)));

    await sendToTab(t, page, { type: 'yt-command', action: 'speed-normal' });
    check('speed: the command speed-normal gives 1 and the toast "Speed 1×"', (await rateIs(page, 1)) && (await until(async () => (await toastText(page)) === 'Speed 1×')), `${await rate(page)} ${await toastText(page)}`);
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-up' });
    check('speed: the command speed-up gives 1.25 and the toast "Speed 1.25×"', (await rateIs(page, 1.25)) && (await until(async () => (await toastText(page)) === 'Speed 1.25×')), `${await rate(page)} ${await toastText(page)}`);
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-default' });
    check('speed: the command speed-default gives the default (1.5)', await rateIs(page, 1.5), String(await rate(page)));
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-normal' });
    await rateIs(page, 1);

    // The wheel: the page is scrolled first, so a wheel the module ignores visibly scrolls it.
    await page.evaluate(() => scrollTo(0, 300));
    await overSpeed(page, '1×');
    const y0 = await page.evaluate(() => scrollY);
    const w0 = await speedWidth(page);
    await page.mouse.wheel(0, -100);
    check('speed: a wheel up over the speed button adds one step and does not scroll the page', (await rateIs(page, 1.25)) && (await page.evaluate(() => scrollY)) === y0, `${await rate(page)} ${y0} ${await page.evaluate(() => scrollY)}`);
    check('speed: the speed button is as wide at "1.25×" as at "1×", so a speed change never re-wraps the row', (await labelIs(page, '1.25×')) && (await speedWidth(page)) === w0, `${w0} ${await speedWidth(page)}`);
    await page.mouse.wheel(0, 100);
    check('speed: a wheel down takes one step off', await rateIs(page, 1), String(await rate(page)));
    await setYouTube(t, { reverseWheel: true });
    await sleep(500); // reverseWheel is read by the isolated world only, so there is no page-visible setting to wait for
    await overSpeed(page, '1×');
    await page.mouse.wheel(0, -100);
    check('speed: with the wheel reversed, up slows down', await rateIs(page, 0.75), String(await rate(page)));
    await setYouTube(t, { reverseWheel: false, speed: { wheel: 'off' } });
    await sleep(300);
    await rowButton(page, 'Faster').click();
    await rateIs(page, 1);
    await overSpeed(page, '1×');
    const y1 = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, -100); // the fixture page is only about 170 px scrollable and is already at the bottom, so the wheel goes up
    await sleep(400);
    check('speed: with the wheel off the page scrolls and the rate stays', (await page.evaluate(() => scrollY)) < y1 && (await rate(page)) === 1, `${y1} ${await page.evaluate(() => scrollY)} ${await rate(page)}`);
    await page.close();

    // YouTube may change the speed after the default went on (a signed-in profile can remember one): the first `playing` puts the default back.
    await setYouTube(t, { speed: { setDefault: true, default: 1.5, wheel: 'over-speed', anySpeed: true } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await rateIs(page, 1.5);
    await page.evaluate(() => document.querySelector('#movie_player video').addEventListener('loadedmetadata', (e) => { e.target.playbackRate = 1; }, { once: true }));
    await navigate(page, 'sieveTest03');
    check('speed: when something resets the speed before the first playing, the default goes on again', await rateIs(page, 1.5), String(await rate(page)));
    await page.close();

    await setYouTube(t, { speed: { setDefault: true, default: 1.6, anySpeed: false } });
    page = await openYt(t, '/watch?v=sieveTest01');
    check('speed: with any speed off the default snaps to an offered speed (1.6 gives 1.5) through the player', (await rateIs(page, 1.5)) && json((await ytCalls(page, 'setPlaybackRate')).map((c) => c.args[0])).startsWith('[1.5'), json(await ytCalls(page, 'setPlaybackRate')));
    await page.close();

    await setYouTube(t, { speed: { setDefault: false, default: 1.5, anySpeed: true } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await sleep(800);
    check('speed: without "Set a default speed" the video stays at 1', (await rate(page)) === 1, String(await rate(page)));
    // A new video starts at 1 without a ratechange event (inspected), so the row has to be told the rate even when no default goes on.
    await quietReset(page);
    await rowButton(page, 'Faster').click();
    check('speed: with no default, Faster gives "1.25×"', (await rateIs(page, 1.25)) && (await labelIs(page, '1.25×')), `${await rate(page)} ${await label(page)}`);
    await navigate(page, 'sieveTest02');
    check('speed: with no default, a new video plays at 1 and the button reads "1×"', (await rateIs(page, 1)) && (await labelIs(page, '1×')), `${await rate(page)} ${await label(page)}`);
    await page.close();

    // The safeguard that puts the default back at the first `playing` must not fight a speed the owner or Sieve chose since. Each page loads
    // paused (autoplay=0) with the default on it, the test plays it only after what it wants to show, and the first case is the control that
    // proves the safeguard is armed (and inside its 5 s window) in this very setup.
    await setYouTube(t, { speed: { setDefault: true, default: 1.5 } });
    const armedPage = async () => {
      const p = await openYt(t, '/watch?v=sieveTest01&autoplay=0');
      await rateIs(p, 1.5);
      await p.evaluate(() => { document.querySelector('#movie_player video').playbackRate = 1; }); // what YouTube may do after the default went on
      return p;
    };
    const playFirst = async (p) => {
      await p.evaluate(() => document.querySelector('#movie_player video').play());
      await p.waitForFunction(() => document.querySelector('#movie_player video').currentTime > 0.3);
      await sleep(300);
    };
    page = await armedPage();
    await playFirst(page);
    check('speed: control: with nothing in between, the first playing puts the default (1.5) back', (await rate(page)) === 1.5, String(await rate(page)));
    await page.close();

    page = await armedPage();
    await sendToTab(t, page, { type: 'yt-command', action: 'speed-normal' });
    await rateIs(page, 1);
    await playFirst(page);
    check('speed: a speed command before the first playing keeps the default from coming back', (await rate(page)) === 1, String(await rate(page)));
    await page.close();

    page = await armedPage();
    await page.keyboard.press('k');
    await playFirst(page);
    check('speed: a key press before the first playing keeps the default from coming back', (await rate(page)) === 1, String(await rate(page)));
    await page.close();

    page = await armedPage();
    await page.mouse.click(5, 300);
    await playFirst(page);
    check('speed: a click before the first playing keeps the default from coming back', (await rate(page)) === 1, String(await rate(page)));
    await page.close();

    page = await armedPage();
    await setYouTube(t, { on: false });
    await until(() => page.evaluate(() => window.__lastSieveSettings?.on === false));
    await playFirst(page);
    check('speed: with the YouTube tools turned off before the first playing the default does not come back', (await rate(page)) === 1, String(await rate(page)));
    await page.close();
    await setYouTube(t, { on: true });

    page = await armedPage();
    await page.evaluate(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 4; });
    await playFirst(page);
    check('speed: a first playing after the video was seeked past 2 s does not bring the default back', (await rate(page)) === 1, String(await rate(page)));
    await page.close();

    await setYouTube(t, { on: false, speed: { setDefault: true, default: 1.5 } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings?.on === false));
    await sleep(800);
    check('speed: with the YouTube tools off the speed is left alone', (await rate(page)) === 1, String(await rate(page)));
    await page.close();
    await setYouTube(t, { on: true });
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

// Plan Step 4: with the default 1.5 the rate is 1.5 three seconds into playback and again after one in-app navigation.
export async function live(t) {
  const { check, page } = t;
  const playing = (seconds) => page.waitForFunction((s) => document.querySelector('#movie_player video')?.currentTime > s, seconds, { timeout: 30_000 }).then(() => true, () => false);
  const facts = () => page.evaluate(() => ({ rate: document.querySelector('#movie_player video')?.playbackRate, id: document.querySelector('#movie_player')?.getVideoData?.().video_id, label: document.querySelector('sieve-yt-row')?.shadowRoot.querySelector('[data-id="speed"] button')?.textContent })).catch(() => null);
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  try {
    await setYouTube(t, { speed: { setDefault: true, default: 1.5 } });
    await page.goto(`https://www.youtube.com/watch?v=${t.videoId}`, { waitUntil: 'domcontentloaded' });
    const gate = await gated();
    if (gate) return console.log(`SKIP  speed live: ${gate}`);
    const ok = await playing(3);
    await sleep(500);
    check('live speed: with the default 1.5 the rate is 1.5 three seconds into playback, and the button reads 1.5×', ok && json(await facts()).includes('"rate":1.5') && (await facts())?.label === '1.5×', json(await facts()));
    const first = (await facts())?.id;
    await page.locator('ytd-watch-next-secondary-results-renderer a[href^="/watch"]').first().click({ timeout: 10_000 });
    await until(async () => (await facts())?.id !== first, 10_000);
    const at = await page.evaluate(() => document.querySelector('#movie_player video').currentTime);
    await page.waitForFunction((s) => document.querySelector('#movie_player video').currentTime > s + 3, at, { timeout: 30_000 }).catch(() => {});
    check('live speed: after one in-app navigation the new video plays at 1.5 too', (await facts())?.rate === 1.5 && (await facts())?.id !== first, json(await facts()));
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube')).catch(() => {});
  }
}
