// Task 2.8 close minors: the reversed playlist keeps working when the page replaces performance.now, and a reload of the same video re-arms the move.
import { SEL } from '../../src/yt/selectors.ts';
import { openYt, row, setYouTube, until, ytCalls } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const reverse = (page) => row(page).getByRole('menuitemcheckbox', { name: 'Reverse playlist' });
const moves = (page) => ytCalls(page, 'playVideoAt');

async function reversed(t, query) {
  const page = await openYt(t, `/watch?v=sieveTest03&list=PLsieve&index=3&autoplay=0${query}`);
  await until(() => page.evaluate((s) => !!document.querySelector(s)?.duration, SEL.video), 3000);
  await row(page).getByRole('button', { name: 'More and settings' }).click();
  await until(() => reverse(page).isVisible(), 2000);
  await reverse(page).click();
  await page.keyboard.press('Escape');
  return page;
}

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { on: true });
    page = await reversed(t, '');
    await page.evaluate(() => (performance.now = () => { throw new Error('replaced by the page'); }));
    await page.evaluate((s) => document.querySelector(s).play(), SEL.video);
    check('reverse guards: with performance.now replaced by the page, the reversed move still happens (playVideoAt 1)', json((await until(() => moves(page).then((m) => m[0]), 8000))?.args) === '[1]', json(await moves(page)));
    await page.close();

    // lag=8000: the first move is still loading when the same video is loaded again from the start.
    page = await reversed(t, '&src=direct&lag=8000');
    await page.evaluate((s) => document.querySelector(s).play(), SEL.video);
    await until(async () => (await moves(page)).length === 1, 8000);
    await page.evaluate((s) => { const v = document.querySelector(s); v.load(); return v.play(); }, SEL.video);
    check('reverse guards: the same video loaded again from the start can be moved again (a second playVideoAt 1)', await until(async () => (await moves(page)).length === 2, 7000), json(await moves(page)));
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}
