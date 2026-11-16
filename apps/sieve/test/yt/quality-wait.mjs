// Task 2.7 close minors: the list source, the 10 s wait (retry, cancel, YouTube tools switched off) and a hand-picked quality in full screen.
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate, openYt, sendToTab, setYouTube, until, ytCalls } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const quality = (page) => ytCalls(page, 'setPlaybackQualityRange').then((calls) => calls.map((c) => c.args[0]));
const settled = (page, want, count = 1) => until(async () => (await quality(page)).filter((q) => q === want).length >= count);
// The fixture's player offers no levels (or throws) until window.__levels is set back to 'ok', as a slow real player does.
const holdLevels = (page, mode) =>
  page.evaluate((m) => {
    const p = document.querySelector('#movie_player');
    window.__levels = m;
    if (!window.__realLevels) {
      window.__realLevels = p.getAvailableQualityLevels;
      p.getAvailableQualityLevels = function () {
        if (window.__levels === 'throw') throw new Error('not ready');
        return window.__levels === 'empty' ? [] : window.__realLevels.call(this);
      };
    }
  }, mode);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { quality: { videos: 'hd720', playlists: 'large' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await settled(page, 'hd720');
    await page.evaluate(() => history.replaceState(history.state, '', `${location.href}&list=PLstale`));
    await setYouTube(t, { quality: { videos: 'medium' } });
    await until(async () => (await quality(page)).length > 1);
    check('quality wait: a list= left in the address after leaving a playlist does not pick the playlists quality; the player says which list plays', json(await quality(page)) === '["hd720","medium"]', json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'auto', playlists: 'auto', videosFull: 'same' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await until(() => page.evaluate(() => window.__lastSieveSettings ?? null));
    await holdLevels(page, 'throw');
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-large' });
    await sleep(700);
    await holdLevels(page, 'ok');
    check('quality wait: a player that throws while it loads is asked again, and the quality is set once it answers', await settled(page, 'large'), json(await quality(page)));

    await holdLevels(page, 'empty');
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-medium' });
    await sleep(400);
    await setYouTube(t, { on: false });
    await until(async () => (await page.evaluate(() => window.__lastSieveSettings?.on)) === false);
    await holdLevels(page, 'ok');
    await sleep(800);
    check('quality wait: switching YouTube tools off stops a quality still waiting to be set', !(await quality(page)).includes('medium'), json(await quality(page)));
    await setYouTube(t, { on: true });

    await holdLevels(page, 'empty');
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-small' });
    await sleep(400);
    await navigate(page, 'sieveTest02');
    await sleep(300);
    await holdLevels(page, 'ok');
    await sleep(800);
    check('quality wait: a new video cancels a quality still waiting from the one before', !(await quality(page)).includes('small'), json(await quality(page)));
    await page.close();

    await setYouTube(t, { quality: { videos: 'hd720', videosFull: 'same' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'fullscreen');
    await settled(page, 'hd720');
    await sendToTab(t, page, { type: 'yt-command', action: 'quality-large' });
    await settled(page, 'large');
    await page.getByRole('button', { name: 'Full screen' }).click();
    await sleep(600);
    await page.evaluate(() => document.exitFullscreen());
    await sleep(600);
    check('quality wait: a quality picked by hand survives entering and leaving full screen when full screen uses the same quality', json(await quality(page)) === '["hd720","large"]', json(await quality(page)));
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}
