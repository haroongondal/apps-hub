// Task 2.10 close minor: a filter change the worker fails to save is taken back off the video, with the reason in the row's toast.
import { SEL } from '../../src/yt/selectors.ts';
import { openYt, row, setYouTube, storedYouTube, until } from './helpers.mjs';

const MESSAGE = 'Sieve could not save the setting. Reload the page, then try again.';
const filter = (page) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).filter, SEL.video);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { on: true, player: { filtersOn: true, filters: { blur: 0 } } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await row(page).getByRole('button', { name: 'Filter options', exact: true }).click();
    await t.sw.evaluate(() => {
      globalThis.__realSet = chrome.storage.local.set;
      chrome.storage.local.set = () => Promise.reject(new Error('test: storage refused'));
    });
    await row(page).getByRole('slider', { name: 'Blur', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    const shownAtOnce = await until(async () => (await filter(page)) === 'blur(1px)', 1000);
    const back = await until(async () => (await filter(page)) === 'none', 3000);
    const toast = await row(page).locator('p.toast').innerText();
    check('visual save: a filter change the worker cannot save shows at once, then goes back to the stored filter, and the toast says why', shownAtOnce && back && toast === MESSAGE && (await storedYouTube(t)).player.filters.blur === 0, JSON.stringify({ shownAtOnce, back, toast, filter: await filter(page) }));
  } finally {
    await t.sw.evaluate(() => { if (globalThis.__realSet) chrome.storage.local.set = globalThis.__realSet; }).catch(() => {});
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}
