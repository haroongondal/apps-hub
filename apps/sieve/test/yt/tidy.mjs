// Task 2.12: page tidying. The local fixtures (watch-full.html, browse.html) have the shapes recorded in src/yt/tidy-selectors.ts.
import { setTimeout as sleep } from 'node:timers/promises';
import { TIDY_SEL, PER_ROW_VAR } from '../../src/yt/tidy-selectors.ts';
import { navigate, openYt, sendToTab, setYouTube, storedYouTube, until } from './helpers.mjs';

const json = JSON.stringify;
const reset = (t) => t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
const display = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sel);
const hidden = async (page, sel) => (await display(page, sel)) === 'none';
const prop = (page, sel, name) => page.evaluate(([s, n]) => getComputedStyle(document.querySelector(s)).getPropertyValue(n).trim(), [sel, name]);
const width = (page, sel) => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width), sel);
const picks = (page) => page.evaluate(() => window.__picks);
const expands = (page) => page.evaluate(() => window.__expands);
const full = (t, query = '') => openYt(t, `/watch?v=sieveTest01${query}`, 'watch-full');
const browse = (t, query = '') => openYt(t, `/?x=1${query}`, 'browse');

const SHORTS_HIDDEN = ['#shelf-shorts', '#item-short-in-grid', '#item-shorts-1', '#guide-shorts', '#mini-shorts', '#tab-shorts'];
const SHORTS_SHOWN = ['#shelf-other', '#item-video-1', '#guide-home', '#grid-shorts'];

export async function local(t) {
  const { check } = t;
  let page;
  try {
    // Hiding.
    await setYouTube(t, { tidy: { hideRelated: true, hideComments: true, hideChat: true, hideCards: true } });
    page = await full(t);
    const targets = ['#related', 'ytd-comments', 'ytd-live-chat-frame', '.ytp-cards-button', '.ytp-cards-teaser', '.ytp-ce-element', '.ytp-ce-covering-overlay', '.ytp-endscreen-content'];
    check('tidy: related, comments, chat, cards and end screens are display none with their switches on', await until(async () => (await Promise.all(targets.map((s) => hidden(page, s)))).every(Boolean)), json(await Promise.all(targets.map((s) => display(page, s)))));
    await setYouTube(t, { tidy: { hideRelated: false, hideComments: false, hideChat: false, hideCards: false } });
    check('tidy: turning the switches off shows them again, without a reload', await until(async () => (await Promise.all(['#related', 'ytd-comments', 'ytd-live-chat-frame', '.ytp-cards-button', '.ytp-endscreen-content'].map((s) => hidden(page, s)))).every((h) => !h)));
    await setYouTube(t, { tidy: { hideComments: true } });
    check('tidy: each switch hides only its own element (comments hidden, related and chat shown)', (await until(() => hidden(page, 'ytd-comments'))) && !(await hidden(page, '#related')) && !(await hidden(page, 'ytd-live-chat-frame')));
    await setYouTube(t, { on: false });
    check('tidy: with YouTube tools off nothing stays hidden', await until(async () => !(await hidden(page, 'ytd-comments'))));
    await page.close();
    await reset(t);

    await setYouTube(t, { tidy: { hideShorts: true } });
    page = await browse(t);
    check('tidy: Hide Shorts hides the shelf, Shorts in grids, the guide entries and the Shorts tab', await until(async () => (await Promise.all(SHORTS_HIDDEN.map((s) => hidden(page, s)))).every(Boolean)), json(await Promise.all(SHORTS_HIDDEN.map((s) => display(page, s)))));
    check('tidy: and leaves the other shelf, videos, the Home entry and the Shorts grid itself', (await Promise.all(SHORTS_SHOWN.map((s) => hidden(page, s)))).every((h) => !h));
    await setYouTube(t, { tidy: { hideShorts: false } });
    check('tidy: turning Hide Shorts off shows them again', await until(async () => (await Promise.all(SHORTS_HIDDEN.map((s) => hidden(page, s)))).every((h) => !h)));
    await page.close();

    // Never painted visible: the first animation frame after the shelf already sees display none. A throwaway load first warms the renderer and storage connection (as theme.mjs does).
    await setYouTube(t, { tidy: { hideShorts: true } });
    await (await browse(t)).close();
    page = await browse(t);
    const first = await until(() => page.evaluate(() => window.__shelf));
    check('tidy: with Hide Shorts stored, the shelf is display none in the first animation frame', first?.display === 'none' && first.applied !== null, `${json(first)} (applied is the sieve-yt-applied mark time; null means no settings had arrived by the first frame)`);
    await page.close();
    await reset(t);

    // Videos per row.
    page = await browse(t);
    await sleep(300);
    check('tidy: with every count 0 nothing is written (the per-row style is empty, YouTube\'s own values stay)', (await page.evaluate(() => document.querySelector('style[data-sieve="per-row"]')?.textContent ?? '')) === '' && (await prop(page, '#grid-videos', PER_ROW_VAR.items)) === '4');
    await setYouTube(t, { tidy: { perRow: { home: 3, channel: 7, shorts: 2, posts: 2 } } });
    check('tidy: "Videos per row on Home" 3 gives --ytd-rich-grid-items-per-row 3 on the grid, and the item width follows', (await until(async () => (await prop(page, '#grid-videos', PER_ROW_VAR.items)) === '3')) && (await width(page, '#item-video-1')) === 1200 / 3 - 8, `${await prop(page, '#grid-videos', PER_ROW_VAR.items)} ${await width(page, '#item-video-1')}`);
    check('tidy: the channel count does not apply on a home page (the Shorts and Posts counts do)', (await prop(page, '#grid-videos', PER_ROW_VAR.items)) === '3' && (await prop(page, '#grid-shorts', PER_ROW_VAR.slim)) === '2' && (await prop(page, '#grid-videos', PER_ROW_VAR.posts)) === '2', `${await prop(page, '#grid-shorts', PER_ROW_VAR.slim)} ${await prop(page, '#grid-videos', PER_ROW_VAR.posts)}`);
    check('tidy: "Shorts per row" 2 gives --ytd-rich-grid-slim-items-per-row 2 and Shorts 592 px wide', (await width(page, '#item-shorts-1')) === 1200 / 2 - 8, String(await width(page, '#item-shorts-1')));
    await page.close();
    page = await browse(t, '&sub=channels');
    check('tidy: on a channel page "Videos per row on channel pages" 7 applies to the Videos grid, not the Shorts grid', (await until(async () => (await prop(page, '#grid-videos', PER_ROW_VAR.items)) === '7')) && (await prop(page, '#grid-shorts', PER_ROW_VAR.items)) === '3', `${await prop(page, '#grid-videos', PER_ROW_VAR.items)} ${await prop(page, '#grid-shorts', PER_ROW_VAR.items)}`);
    await setYouTube(t, { tidy: { perRow: { channel: 0 } } });
    check('tidy: setting it back to 0 gives YouTube\'s own value back', await until(async () => (await prop(page, '#grid-videos', PER_ROW_VAR.items)) === '4'));
    await page.close();
    await reset(t);

    // Convert Shorts.
    await setYouTube(t, { tidy: { convertShorts: true } });
    page = await browse(t);
    await page.evaluate(() => (window.__marker = 1));
    await sleep(300);
    await page.click('#short-link');
    await page.waitForURL(/\/watch\?v=sieveTest01$/, { timeout: 5000 }).catch(() => {});
    check('tidy: a click on a Short\'s link loads /watch?v=sieveTest01, a new document', /\/watch\?v=sieveTest01$/.test(page.url()) && (await page.evaluate(() => window.__marker)) === undefined, page.url());
    await page.close();
    page = await openYt(t, '/shorts/sieveTest01', 'browse');
    await page.waitForURL(/\/watch\?v=sieveTest01$/, { timeout: 5000 }).catch(() => {});
    check('tidy: loading /shorts/sieveTest01 ends at /watch?v=sieveTest01', /\/watch\?v=sieveTest01$/.test(page.url()), page.url());
    await page.close();
    await setYouTube(t, { tidy: { convertShorts: false } });
    page = await browse(t);
    await sleep(300);
    await page.click('#short-link');
    await page.waitForURL(/\/shorts\/sieveTest01/, { timeout: 5000 }).catch(() => {});
    await sleep(600);
    check('tidy: with the switch off a click on a Short stays on /shorts/sieveTest01', /\/shorts\/sieveTest01/.test(page.url()), page.url());
    await page.close();
    page = await openYt(t, '/shorts/sieveTest01', 'browse');
    await sleep(800);
    check('tidy: and loading /shorts/sieveTest01 stays there', /\/shorts\/sieveTest01/.test(page.url()), page.url());
    await page.close();
    await reset(t);

    // Newest comments and the description, early and late.
    for (const query of ['', '&late=1']) {
      const label = query ? 'late' : 'early';
      await setYouTube(t, { tidy: { newestComments: true, expandDescription: true } });
      page = await full(t, query);
      check(`tidy: (${label}) the newest-first item is picked once`, await until(async () => json(await picks(page)) === '[1]'), json(await picks(page)));
      check(`tidy: (${label}) the description is expanded once, to the recorded is-expanded state`, (await until(async () => (await expands(page)) === 1)) && (await page.evaluate((a) => document.querySelector('ytd-text-inline-expander').hasAttribute(a), 'is-expanded')), String(await expands(page)));
      await sleep(1200);
      check(`tidy: (${label}) and not again later`, json(await picks(page)) === '[1]' && (await expands(page)) === 1, `${json(await picks(page))} ${await expands(page)}`);
      await navigate(page, 'sieveTest02');
      check(`tidy: (${label}) after a navigation the next video gets one pick and one expand`, (await until(async () => json(await picks(page)) === '[1,1]' && (await expands(page)) === 2)) && (await (sleep(800), picks(page))).length === 2, `${json(await picks(page))} ${await expands(page)}`);
      await page.close();
      await reset(t);
    }
    await setYouTube(t, { tidy: { newestComments: false, expandDescription: false } });
    page = await full(t, '&late=1');
    await sleep(1800);
    check('tidy: with both switches off nothing is picked or expanded', json(await picks(page)) === '[]' && (await expands(page)) === 0);
    await page.close();
    await reset(t);

    // A stale header: the last video's header already says Newest, the new video's says Top later. Nothing is picked until the Top one shows.
    await setYouTube(t, { tidy: { newestComments: true } });
    page = await full(t);
    await until(async () => json(await picks(page)) === '[1]');
    await page.evaluate(() => { document.querySelectorAll('#sort-menu a').forEach((a, i) => a.setAttribute('aria-selected', String(i === 1))); });
    await page.evaluate(() => { window.__picks.length = 0; });
    await page.evaluate(() => window.__navigate('sieveTest03'));
    await sleep(100);
    check('tidy: the next video\'s header (Top selected) is picked once it replaces the old one', await until(async () => json(await picks(page)) === '[1]'), json(await picks(page)));
    await page.close();
    await reset(t);

    // The shortcut path.
    page = await full(t);
    await sleep(600);
    const sent = await sendToTab(t, page, { type: 'yt-command', action: 'comments' });
    check('tidy: the "comments" shortcut stores tidy.hideComments true and hides the comments', (await until(async () => (await storedYouTube(t))?.tidy?.hideComments === true)) && (await until(() => hidden(page, 'ytd-comments'))), json({ sent, stored: (await storedYouTube(t))?.tidy }));
    await sendToTab(t, page, { type: 'yt-command', action: 'comments' });
    check('tidy: sending it again shows them', (await until(async () => (await storedYouTube(t))?.tidy?.hideComments === false)) && (await until(async () => !(await hidden(page, 'ytd-comments')))));
    for (const [action, key, sel] of [['related', 'hideRelated', '#related'], ['cards', 'hideCards', '.ytp-cards-button']]) {
      await sendToTab(t, page, { type: 'yt-command', action });
      check(`tidy: the "${action}" shortcut toggles tidy.${key}`, (await until(async () => (await storedYouTube(t))?.tidy?.[key] === true)) && (await until(() => hidden(page, sel))));
    }
    await page.close();
  } finally {
    await page?.close().catch(() => {});
    await reset(t);
  }
}

// Live: signed out, the real pages. Selector names come from src/yt/tidy-selectors.ts.
export async function live(t) {
  const { check, page } = t;
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  const go = async (url, ready) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    if (ready) await page.waitForSelector(ready, { state: 'attached', timeout: 20_000 }).catch(() => {});
    await sleep(2500);
    return gated();
  };
  const found = async (name, sel, min = 1) => check(`live tidy: ${name} (${sel}) is on its page`, (await page.locator(sel).count()) >= min, `${await page.locator(sel).count()} found`);
  try {
    let gate = await go(`https://www.youtube.com/watch?v=${t.videoId}`, TIDY_SEL.expander);
    if (gate) return console.log(`SKIP  tidy live: ${gate}`);
    for (const [name, sel, min] of [['comments', TIDY_SEL.comments], ['description', TIDY_SEL.below], ['expander', TIDY_SEL.expander], ['expand button', `${TIDY_SEL.expander} ${TIDY_SEL.expand}`], ['related column', TIDY_SEL.related], ['info cards button', TIDY_SEL.cardsButton], ['end screen elements', TIDY_SEL.endScreen]]) await found(name, sel, min);
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView(), TIDY_SEL.comments);
    await until(() => page.locator(`${TIDY_SEL.comments} ${TIDY_SEL.sortItems}`).count().then((n) => n >= 2), 15_000);
    await found('comments sort items, two', `${TIDY_SEL.comments} ${TIDY_SEL.sortItems}`, 2);

    await setYouTube(t, { tidy: { hideComments: true, hideRelated: true, hideCards: true } });
    const shown = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, sel);
    check('live tidy: "Hide comments", "Hide related videos" and "Hide cards" hide the real ones', (await until(async () => (await shown(TIDY_SEL.comments)) === 'none')) && (await shown(TIDY_SEL.related)) === 'none' && (await shown(TIDY_SEL.cardsButton)) === 'none');
    await setYouTube(t, { tidy: { hideComments: false, hideRelated: false, hideCards: false, newestComments: true, expandDescription: true } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(TIDY_SEL.expander, { state: 'attached', timeout: 20_000 }).catch(() => {});
    check('live tidy: "Expand video descriptions" expands the real description', await until(() => page.evaluate(([s, a]) => document.querySelector(s)?.hasAttribute(a), [TIDY_SEL.expander, 'is-expanded']), 15_000));
    await page.evaluate((s) => document.querySelector(s)?.scrollIntoView(), TIDY_SEL.comments);
    check('live tidy: after scrolling to the comments the newest-first item is selected', await until(() => page.evaluate(([s]) => document.querySelectorAll(s)[1]?.getAttribute('aria-selected') === 'true', [`${TIDY_SEL.comments} ${TIDY_SEL.sortItems}`]), 20_000));
    await reset(t);

    gate = await go('https://www.youtube.com/results?search_query=funny+cats', TIDY_SEL.gridShelf);
    if (gate) return console.log(`SKIP  tidy live search: ${gate}`);
    await found('a Shorts lockup in a search shelf', `${TIDY_SEL.gridShelf} ${TIDY_SEL.shortsLockup}`);
    await found('the side guide\'s Shorts entry', TIDY_SEL.guideShorts);
    await setYouTube(t, { tidy: { hideShorts: true } });
    const shelfHidden = () => page.evaluate(([g, l]) => [...document.querySelectorAll(g)].filter((e) => e.querySelector(l)).every((e) => getComputedStyle(e).display === 'none'), [TIDY_SEL.gridShelf, TIDY_SEL.shortsLockup]);
    check('live tidy: "Hide Shorts" hides the Shorts shelves of a search and the guide entry', (await until(shelfHidden)) && (await page.evaluate((s) => getComputedStyle(document.querySelector(s).closest('ytd-guide-entry-renderer')).display, TIDY_SEL.guideShorts)) === 'none');
    await reset(t);
    await page.setViewportSize({ width: 800, height: 900 });
    await sleep(800);
    await found('the mini guide\'s Shorts entry (800 px wide)', TIDY_SEL.miniGuideShorts);
    await page.setViewportSize({ width: 1280, height: 720 });

    gate = await go('https://www.youtube.com/@YouTube/videos', TIDY_SEL.gridItem);
    if (gate) return console.log(`SKIP  tidy live channel: ${gate}`);
    await found('a channel\'s grid', TIDY_SEL.grid);
    await found('a channel video', TIDY_SEL.gridItem);
    await found('the channel tab Shorts', TIDY_SEL.channelTabShorts);
    check('live tidy: ytd-browse has page-subtype "channels" on a channel page', (await page.locator('ytd-browse[page-subtype="channels"]').count()) === 1);
    const before = await page.evaluate(([s]) => Math.round(document.querySelector(s).getBoundingClientRect().width), [TIDY_SEL.gridItem]);
    await setYouTube(t, { tidy: { perRow: { channel: 2 } } });
    await until(async () => (await page.evaluate(([s]) => Math.round(document.querySelector(s).getBoundingClientRect().width), [TIDY_SEL.gridItem])) > before + 50);
    const after = await page.evaluate(([s, g, v]) => ({ w: Math.round(document.querySelector(s).getBoundingClientRect().width), v: getComputedStyle(document.querySelector(g)).getPropertyValue(v).trim() }), [TIDY_SEL.gridItem, TIDY_SEL.grid, PER_ROW_VAR.items]);
    check('live tidy: "Videos per row on channel pages" 2 gives --ytd-rich-grid-items-per-row 2 on the Videos grid and wider videos', after.v === '2' && after.w > before + 50, json({ before, after }));
    await reset(t);

    gate = await go('https://www.youtube.com/@YouTube/shorts', TIDY_SEL.shortsGridItem);
    if (gate) return console.log(`SKIP  tidy live shorts tab: ${gate}`);
    await found('a Shorts grid item', TIDY_SEL.shortsGridItem);
    const sBefore = await page.evaluate(([s]) => Math.round(document.querySelector(s).getBoundingClientRect().width), [TIDY_SEL.shortsGridItem]);
    await setYouTube(t, { tidy: { perRow: { shorts: 2 } } });
    await until(async () => (await page.evaluate(([s]) => Math.round(document.querySelector(s).getBoundingClientRect().width), [TIDY_SEL.shortsGridItem])) > sBefore + 50);
    const sAfter = await page.evaluate(([s]) => Math.round(document.querySelector(s).getBoundingClientRect().width), [TIDY_SEL.shortsGridItem]);
    check('live tidy: "Shorts per row" 2 makes the Shorts on a channel\'s Shorts tab wider', sAfter > sBefore + 50, json({ sBefore, sAfter }));
    await reset(t);

    // A public live stream with chat, found with the search filter for live. Not every address gets one: no stream is a note, not a failure.
    gate = await go('https://www.youtube.com/results?search_query=live+news&sp=EgJAAQ%253D%253D', 'ytd-video-renderer');
    const href = gate ? null : await page.evaluate(() => [...document.querySelectorAll('ytd-video-renderer')].find((e) => /\blive\b/i.test(e.textContent))?.querySelector('a[href^="/watch"]')?.getAttribute('href') ?? null);
    if (!href) console.log(`tidy live chat: no live stream found (${gate ?? 'search had none'}), chat selector unchecked`);
    else {
      await go(`https://www.youtube.com${href}`, TIDY_SEL.chat);
      await until(() => page.locator(TIDY_SEL.chat).count(), 15_000);
      await found('the live chat frame', TIDY_SEL.chat);
      await setYouTube(t, { tidy: { hideChat: true } });
      check('live tidy: "Hide live chat" hides the real chat', await until(async () => (await page.locator(TIDY_SEL.chat).count()) === 0 || (await page.evaluate((s) => getComputedStyle(document.querySelector(s)).display, TIDY_SEL.chat)) === 'none'));
    }
  } finally {
    await reset(t).catch(() => {});
    await page.setViewportSize({ width: 1280, height: 720 }).catch(() => {});
    await page.goto(`https://www.youtube.com/watch?v=${t.videoId}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
}
