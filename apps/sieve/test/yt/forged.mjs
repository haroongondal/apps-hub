// Review Focus 4: a page script that calls click() on the row's controls, or sends them untrusted events, changes nothing.
import { setTimeout as sleep } from 'node:timers/promises';
import { SEL } from '../../src/yt/selectors.ts';
import { openYt, row, setYouTube, storedYouTube, until } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const SETTLE_MS = 400; // visual.ts saves 150 ms after a slider change, then the worker writes

const forgeIn = ({ scope, sel, index, kind, value }) => {
  const root = scope === 'row' ? document.querySelector('sieve-yt-row').shadowRoot : document;
  const all = [...root.querySelectorAll(sel)];
  const els = index === undefined ? all : all.slice(index, index + 1);
  const opts = { bubbles: true, cancelable: true, composed: true };
  for (const el of els) {
    if (kind === 'click') el.click();
    else if (kind === 'wheel') el.dispatchEvent(new WheelEvent('wheel', { ...opts, deltaY: -100 }));
    else if (kind === 'escape') el.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: 'Escape' }));
    else if (kind === 'outside') el.dispatchEvent(new PointerEvent('pointerdown', opts));
    else {
      el.value = value ?? el.min;
      el.dispatchEvent(new Event(kind, { bubbles: true }));
    }
  }
  return els.length;
};

const pageState = (s) => {
  const v = document.querySelector(s.video);
  const html = document.documentElement;
  return {
    row: document.querySelector('sieve-yt-row').shadowRoot.querySelector('.row').outerHTML,
    calls: window.__ytCalls.filter((c) => !/^(get|is)/.test(c.name) && c.name !== 'addEventListener').map((c) => c.name),
    sent: window.__sieveDo.length,
    video: [v.loop, v.playbackRate, v.volume, v.muted],
    pip: !!document.pictureInPictureElement,
    styles: [html.getAttribute('sieve-yt'), html.style.cssText, document.querySelector(s.player).style.cssText],
    backdrop: !!document.querySelector('sieve-yt-backdrop')?.isConnected,
    url: location.href,
  };
};

const snapshot = async (t, page) => ({
  stored: await storedYouTube(t),
  downloads: await t.sw.evaluate(() => chrome.downloads.search({}).then((r) => r.length)),
  tabs: t.ctx.pages().length,
  page: await page.evaluate(pageState, SEL),
});

const diff = (a, b) => Object.keys(a).filter((k) => json(a[k]) !== json(b[k])).map((k) => `${k}: ${json(a[k]).slice(0, 300)} -> ${json(b[k]).slice(0, 300)}`).join('; ');

export async function local(t) {
  const { check } = t;
  let page;
  const found = { switches: 0, sliders: 0, texts: 0, popButtons: 0, barButtons: 0 };
  const forged = async (name, arg) => {
    const before = await snapshot(t, page);
    const hit = await page.evaluate(forgeIn, arg);
    await sleep(SETTLE_MS);
    const after = await snapshot(t, page);
    if (hit) check(`forged: ${name} changes nothing`, json(before) === json(after), diff(before, after));
    return hit;
  };
  try {
    await setYouTube(t, { player: { cinema: true, filters: { brightness: 120 } }, volume: { wheel: 'over-video', boostOn: true }, tidy: { convertShorts: true } });
    page = await openYt(t, '/watch?v=sieveTest01&autoplay=0');
    await until(() => row(page).count().then((n) => n === 1), 3000);
    await until(() => page.evaluate(() => !!document.querySelector('sieve-yt-backdrop')?.isConnected), 3000);
    await sleep(800);

    const labels = await page.evaluate(() => [...document.querySelector('sieve-yt-row').shadowRoot.querySelectorAll('.bar button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()));
    for (const [index, label] of labels.entries()) found.barButtons += await forged(`a click() on the row button "${label}"`, { scope: 'row', sel: '.bar button', index, kind: 'click' });
    await forged('an untrusted wheel on the speed button', { scope: 'row', sel: '[data-id="speed"] > button', kind: 'wheel' });
    await forged('an untrusted wheel on the player', { scope: 'doc', sel: SEL.player, kind: 'wheel' });
    await forged('a click() on the cinema backdrop', { scope: 'doc', sel: 'sieve-yt-backdrop', kind: 'click' });

    const openers = await page.evaluate(() => [...document.querySelector('sieve-yt-row').shadowRoot.querySelectorAll('.bar [aria-haspopup="true"]')].map((b) => b.getAttribute('aria-label')));
    for (const opener of openers) {
      const button = row(page).getByRole('button', { name: opener, exact: true });
      await button.click();
      const opened = await until(() => page.evaluate(() => !!document.querySelector('sieve-yt-row').shadowRoot.querySelector('.pop')), 2000);
      check(`forged: a real click on "${opener}" opens its popover (the control for the checks below)`, opened);
      if (!opened) continue;
      found.switches += await forged(`in "${opener}", a click() on each switch`, { scope: 'row', sel: '.pop [role="switch"]', kind: 'click' });
      found.sliders += await forged(`in "${opener}", an untrusted input on each slider`, { scope: 'row', sel: '.pop input[type="range"]', kind: 'input' });
      await forged(`in "${opener}", an untrusted change on each slider`, { scope: 'row', sel: '.pop input[type="range"]', kind: 'change' });
      found.texts += await forged(`in "${opener}", an untrusted change on each time box`, { scope: 'row', sel: '.pop input[type="text"]', kind: 'change', value: 'zz' });
      found.popButtons += await forged(`in "${opener}", a click() on each button`, { scope: 'row', sel: '.pop button', kind: 'click' });
      await forged(`in "${opener}", an untrusted Escape`, { scope: 'row', sel: '.pop', kind: 'escape' });
      await forged(`in "${opener}", an untrusted pointerdown outside`, { scope: 'doc', sel: 'body', kind: 'outside' });
      await button.click();
    }
    check('forged: every kind of control was reached', found.barButtons >= 9 && found.switches >= 4 && found.sliders >= 8 && found.texts >= 2 && found.popButtons >= 6, json(found));
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest01&autoplay=0');
    await until(() => page.evaluate(() => window.__lastSieveSettings ?? null));
    const first = await t.sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((x) => x.url === url);
      const port = chrome.tabs.connect(tab.id, { name: 'yt-menu', frameId: 0 });
      const got = await new Promise((resolve) => {
        port.onMessage.addListener(resolve);
        port.onDisconnect.addListener(() => resolve(null));
      });
      port.postMessage({ type: 'do', action: 'nope' });
      await new Promise((r) => setTimeout(r, 400));
      port.disconnect();
      return got?.type ?? null;
    }, page.url());
    const relayed = await page.evaluate(() => window.__sieveDo);
    check('forged: an action the menu does not offer, sent on its port, is not relayed to the main world', first === 'state' && relayed.length === 0, json({ first, relayed }));
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest01&autoplay=0');
    await until(() => page.evaluate(() => window.__lastSieveSettings ?? null));
    const url = page.url();
    await page.evaluate(() => {
      window.__stay = true;
      const a = Object.assign(document.createElement('a'), { href: '/shorts/sieveTest02', textContent: 'A Short' });
      document.body.append(a);
      // Without Sieve the link would load /shorts/; the page keeps it here so only a conversion can move it. Sieve's capture listener runs first.
      window.addEventListener('click', (e) => e.preventDefault());
      a.click();
    });
    await sleep(800);
    const stayed = await page.evaluate(() => window.__stay === true).catch(() => false);
    check('forged: a click() on a link to a Short is not converted to the watch page', stayed && page.url() === url, page.url());
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}
