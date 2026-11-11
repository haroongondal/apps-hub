// Task 2.6. "No click yet" is read from navigator.userActivation (yt-e2e.mjs's autoplay flag does not change it); WebAudio is watched through CDP, which sees every world.
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate, openYt, row, rowButton, setYouTube, storedYouTube, until, ytCalls, ytUrl } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const toastText = (page) => row(page).getByRole('status').innerText();
const video = (page) => page.evaluate(() => { const v = document.querySelector('#movie_player video'); return { time: v.currentTime, muted: v.muted, mark: v.getAttribute('sieve-boost'), rate: v.playbackRate }; });
const volumes = async (page) => (await ytCalls(page, 'setVolume')).map((c) => c.args[0]);
const scrollY = (page) => page.evaluate(() => scrollY);
const rightWheel = async (page, dy = -100) => {
  await page.mouse.down({ button: 'right' });
  await page.mouse.wheel(0, dy);
  await page.mouse.up({ button: 'right' });
};

async function openAudio(t, path) {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  const audio = { contexts: new Map(), nodes: new Map(), links: [] };
  const cdp = await t.ctx.newCDPSession(page);
  cdp.on('WebAudio.contextCreated', (e) => audio.contexts.set(e.context.contextId, { ...e.context }));
  cdp.on('WebAudio.contextChanged', (e) => audio.contexts.set(e.context.contextId, { ...e.context }));
  cdp.on('WebAudio.audioNodeCreated', (e) => audio.nodes.set(e.node.nodeId, e.node));
  cdp.on('WebAudio.nodesConnected', (e) => audio.links.push(e));
  await cdp.send('WebAudio.enable');
  await page.goto(ytUrl(t, path), { waitUntil: 'load' });
  // Playwright's evaluate runs with userGesture: true, which would give the page the activation under test.
  const peek = (expression) => cdp.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: false }).then((r) => r.result.value);
  return { page, audio, peek };
}

const running = (audio) => [...audio.contexts.values()].filter((c) => c.contextState === 'running');
const sources = (audio) => [...audio.nodes.values()].filter((n) => n.nodeType === 'MediaElementAudioSource').length;
const kind = (audio, id) => audio.nodes.get(id)?.nodeType;
const chained = (audio) => {
  const from = (k) => audio.links.filter((l) => kind(audio, l.sourceId) === k);
  return from('MediaElementAudioSource').some((a) => kind(audio, a.destinationId) === 'Gain' && from('Gain').some((b) => b.sourceId === a.destinationId && kind(audio, b.destinationId) === 'AudioDestination'));
};
const advancing = async (page) => {
  const a = (await video(page)).time;
  await sleep(1000);
  return (await video(page)).time > a + 0.3;
};

export async function local(t) {
  const { check } = t;
  let page;
  let audio;
  let peek;
  // Scrolled first, so a wheel the module ignores visibly scrolls the page.
  const scrolled = async () => {
    const p = await openYt(t, '/watch?v=sieveTest01');
    await p.evaluate(() => scrollTo(0, 100));
    await sleep(300);
    await p.mouse.move(400, 80); // the fixture's player is only 150 px tall, and the masthead covers the top 56 px
    return p;
  };
  try {
    await setYouTube(t, { volume: { setDefault: true, level: 30 } });
    page = await openYt(t, '/watch?v=sieveTest01');
    check('volume: with a default of 30 the player gets setVolume(30) after load', await until(async () => (await volumes(page)).includes(30)), json(await volumes(page)));
    const before = (await volumes(page)).length;
    await navigate(page, 'sieveTest02');
    check('volume: and again after an in-app navigation', await until(async () => (await volumes(page)).length > before && (await volumes(page)).at(-1) === 30), json(await volumes(page)));
    await page.close();

    page = await openYt(t, '/watch?v=sieveTest01');
    await page.evaluate(() => document.querySelector('#movie_player').mute());
    await navigate(page, 'sieveTest03');
    check('volume: a default above 0 unmutes a muted player', await until(async () => !(await video(page)).muted), json(await video(page)));
    await page.close();

    await setYouTube(t, { volume: { setDefault: false } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await sleep(500);
    check('volume: without "Set a default volume" the player is left alone', (await volumes(page)).length === 0, json(await volumes(page)));
    await page.close();

    await setYouTube(t, { volume: { boostOn: true, boost: 2 } });
    ({ page, audio, peek } = await openAudio(t, '/watch?v=sieveTest01'));
    const look = () => peek("(() => { const v = document.querySelector('#movie_player video'); return { time: v.currentTime, muted: v.muted, mark: v.getAttribute('sieve-boost'), active: navigator.userActivation.hasBeenActive }; })()");
    await until(async () => (await look()).time > 1.5, 8000);
    await sleep(500);
    const v = await look();
    check('boost: with boost stored and no click yet, no AudioContext is made, the video plays and is not muted', audio.contexts.size === 0 && v.time > 1.5 && !v.muted && v.mark === null, json({ contexts: audio.contexts.size, ...v }));
    check('boost: the page has had no activation at that point', v.active === false);
    await page.keyboard.press('Escape');
    await sleep(400);
    check('boost: an Escape key press carries no activation, so still no context', audio.contexts.size === 0, String(audio.contexts.size));
    await page.mouse.click(5, 300);
    check('boost: after a click there is one running context within a second', await until(() => running(audio).length === 1 && audio.contexts.size === 1, 1000), json([...audio.contexts.values()]));
    check('boost: a media element source goes to a gain node that goes to the destination', await until(() => chained(audio), 1000), json({ nodes: [...audio.nodes.values()].map((n) => n.nodeType), links: audio.links.length }));
    check('boost: the video is marked sieve-boost="running"', await until(async () => (await video(page)).mark === 'running'), json(await video(page)));
    check('boost: the video keeps advancing and is not muted', (await advancing(page)) && !(await video(page)).muted, json(await video(page)));
    check('boost: one source node so far', sources(audio) === 1, String(sources(audio)));
    await navigate(page, 'sieveTest02');
    await sleep(500);
    check('boost: after an in-app navigation the element keeps its one source node and one context, and plays on', sources(audio) === 1 && audio.contexts.size === 1 && (await video(page)).mark === 'running' && (await advancing(page)), json({ sources: sources(audio), contexts: audio.contexts.size, ...(await video(page)) }));
    await page.close();

    await setYouTube(t, { volume: { boostOn: false, boost: 2.5 } });
    ({ page, audio } = await openAudio(t, '/watch?v=sieveTest01'));
    const boost = rowButton(page, 'Boost volume');
    await boost.waitFor();
    check('boost: the button\'s title has the multiplier', (await boost.getAttribute('title')) === 'Boost volume ×2.5', String(await boost.getAttribute('title')));
    check('boost: with boost off the button is not pressed and there is still no context', (await boost.getAttribute('aria-pressed')) === 'false' && audio.contexts.size === 0);
    await boost.click();
    check('boost: a click flips aria-pressed and youtube.volume.boostOn', (await until(async () => (await boost.getAttribute('aria-pressed')) === 'true')) && (await storedYouTube(t))?.volume?.boostOn === true, json((await storedYouTube(t))?.volume));
    check('boost: and the video is routed', await until(async () => (await video(page)).mark === 'running' && running(audio).length === 1), json({ ...(await video(page)), contexts: audio.contexts.size }));
    await boost.click();
    check('boost: a second click turns it off, drops the mark, and keeps the one context', (await until(async () => (await boost.getAttribute('aria-pressed')) === 'false' && (await video(page)).mark === null)) && audio.contexts.size === 1, json({ ...(await video(page)), contexts: audio.contexts.size }));
    await boost.click();
    check('boost: turning it on again routes the video again with the same source node', (await until(async () => (await video(page)).mark === 'running')) && sources(audio) === 1, json({ ...(await video(page)), sources: sources(audio) }));
    await setYouTube(t, { on: false });
    check('boost: with the YouTube tools off the gain goes back to 1 (no mark)', await until(async () => (await video(page)).mark === null), json(await video(page)));
    await setYouTube(t, { on: true });
    await page.close();

    await setYouTube(t, { volume: { boostOn: false, boost: 2 } });
    ({ page, audio } = await openAudio(t, '/watch?v=sieveTest01&src=direct'));
    await rowButton(page, 'Boost volume').click();
    check('boost: a direct (non-blob) source says "Sieve can\'t boost this video."', await until(async () => (await toastText(page)) === "Sieve can't boost this video."), await toastText(page));
    await sleep(300);
    check('boost: and no context is made', audio.contexts.size === 0 && (await video(page)).mark === null, json({ contexts: audio.contexts.size, ...(await video(page)) }));
    await page.close();

    await setYouTube(t, { volume: { setDefault: true, level: 50, step: 5, boostOn: false, wheel: 'over-video' }, speed: { wheel: 'over-speed' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    await page.mouse.wheel(0, -100);
    check('wheel: over the video one wheel up gives setVolume(55) (from 50) and the page does not scroll', (await until(async () => (await volumes(page)).includes(55))) && (await scrollY(page)) === 100, json({ calls: await volumes(page), scrollY: await scrollY(page) }));
    check('wheel: the row toasts "Volume 55%"', await until(async () => (await toastText(page)) === 'Volume 55%'), await toastText(page));
    await page.mouse.wheel(0, 100);
    check('wheel: a wheel down gives setVolume(50)', await until(async () => (await volumes(page)).at(-1) === 50), json(await volumes(page)));
    await setYouTube(t, { reverseWheel: true });
    await sleep(500);
    await page.mouse.wheel(0, -100);
    check('wheel: with the wheel reversed up gives 45', await until(async () => (await volumes(page)).at(-1) === 45), json(await volumes(page)));
    await setYouTube(t, { reverseWheel: false });
    await sleep(500);
    await page.evaluate(() => document.querySelector('#movie_player').setVolume(98));
    await page.mouse.wheel(0, -100);
    check('wheel: the volume stops at 100 and still toasts "Volume 100%"', (await until(async () => (await volumes(page)).at(-1) === 100)) && (await until(async () => (await toastText(page)) === 'Volume 100%')), `${json(await volumes(page))} ${await toastText(page)}`);
    await page.close();

    await setYouTube(t, { volume: { wheel: 'off' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    const calls = (await volumes(page)).length;
    await page.mouse.wheel(0, -100);
    await sleep(400);
    check('wheel: with the wheel off the page scrolls and the setter is not called', (await scrollY(page)) < 100 && (await volumes(page)).length === calls, json({ scrollY: await scrollY(page), calls: await volumes(page) }));
    await page.close();

    await setYouTube(t, { on: false, volume: { wheel: 'over-video' } });
    page = await scrolled();
    await sleep(300);
    await page.mouse.wheel(0, -100);
    await sleep(400);
    check('wheel: with the YouTube tools off the page scrolls and nothing is set', (await scrollY(page)) < 100 && (await volumes(page)).length === 0, json({ scrollY: await scrollY(page), calls: await volumes(page) }));
    await page.close();
    await setYouTube(t, { on: true });

    await setYouTube(t, { volume: { wheel: 'right-button' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    await page.mouse.wheel(0, -100);
    await sleep(400);
    check('wheel: with the right button chosen, a wheel without the button scrolls the page and sets nothing', (await scrollY(page)) < 100 && (await volumes(page)).length === 1, json({ scrollY: await scrollY(page), calls: await volumes(page) }));
    await page.evaluate(() => { scrollTo(0, 100); window.__ctx.length = 0; });
    await sleep(200);
    await rightWheel(page);
    check('wheel: the right button held plus a wheel gives setVolume(55)', await until(async () => (await volumes(page)).includes(55)), json(await volumes(page)));
    await sleep(300);
    check('wheel: and the page did not scroll and no context menu came', (await scrollY(page)) === 100 && (await page.evaluate(() => window.__ctx.length)) === 0, json({ scrollY: await scrollY(page), ctx: await page.evaluate(() => window.__ctx) }));
    await page.evaluate(() => { window.__ctx.length = 0; });
    await page.mouse.click(400, 80, { button: 'right' });
    await sleep(200);
    check('wheel: a later plain right click still reaches the page\'s context menu', (await page.evaluate(() => window.__ctx.length)) === 1, json(await page.evaluate(() => window.__ctx)));
    await page.close();

    // Review fixes: sideways wheels, a right press that no right-button mode wants, and a blur in the middle of a gesture.
    await setYouTube(t, { volume: { wheel: 'over-video' }, speed: { wheel: 'over-speed' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    await page.evaluate(() => { window.__wheelPrevented = []; document.addEventListener('wheel', (e) => window.__wheelPrevented.push(e.defaultPrevented)); });
    await page.mouse.wheel(100, 0);
    await sleep(300);
    check('wheel: a sideways wheel over the video is not default-prevented and sets no volume', json(await page.evaluate(() => window.__wheelPrevented)) === '[false]' && (await volumes(page)).length === 1, json({ prevented: await page.evaluate(() => window.__wheelPrevented), calls: await volumes(page) }));
    await page.mouse.down({ button: 'right' });
    await page.mouse.wheel(0, -100);
    check('wheel: with no right-button mode on, a right press does not stop the plain wheel from changing the volume', await until(async () => (await volumes(page)).includes(55)), json(await volumes(page)));
    await page.mouse.up({ button: 'right' });
    await page.close();

    await setYouTube(t, { volume: { wheel: 'right-button' }, speed: { wheel: 'over-speed' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    await page.mouse.down({ button: 'right' });
    await page.mouse.wheel(0, -100);
    await until(async () => (await volumes(page)).includes(55));
    await page.evaluate(() => { window.__ctx.length = 0; window.dispatchEvent(new Event('blur')); });
    await page.mouse.up({ button: 'right' });
    await page.mouse.click(5, 300, { button: 'right' });
    await sleep(200);
    check('wheel: after a blur mid-gesture a plain right click elsewhere is not eaten', (await page.evaluate(() => window.__ctx.length)) === 1, json(await page.evaluate(() => window.__ctx)));
    await page.close();

    await setYouTube(t, { volume: { setDefault: false, wheel: 'off' }, speed: { wheel: 'right-button', setDefault: false, step: 0.25, anySpeed: true } });
    page = await scrolled();
    await page.mouse.wheel(0, -100);
    await sleep(400);
    check('wheel: with the speed wheel on the right button, a wheel alone scrolls the page', (await scrollY(page)) < 100 && (await video(page)).rate === 1, json({ scrollY: await scrollY(page), ...(await video(page)) }));
    await page.evaluate(() => scrollTo(0, 100));
    await sleep(200);
    await rightWheel(page);
    check('wheel: the right button held plus a wheel up adds 0.25 to the speed', await until(async () => (await video(page)).rate === 1.25), json(await video(page)));
    check('wheel: ...and the row toasts "Speed 1.25×" with no volume call', (await until(async () => (await toastText(page)) === 'Speed 1.25×')) && (await volumes(page)).length === 0, `${await toastText(page)} ${json(await volumes(page))}`);
    await setYouTube(t, { reverseWheel: true });
    await sleep(500);
    await page.evaluate(() => scrollTo(0, 100));
    await rightWheel(page);
    check('wheel: reversed, the wheel up takes 0.25 off', await until(async () => (await video(page)).rate === 1), json(await video(page)));
    await page.close();
    await setYouTube(t, { reverseWheel: false });

    await setYouTube(t, { volume: { setDefault: true, level: 50, wheel: 'over-video' }, speed: { wheel: 'right-button' } });
    page = await scrolled();
    await until(async () => (await volumes(page)).includes(50));
    await page.mouse.wheel(0, -100);
    check('wheel: with speed on the right button and volume over the video, a plain wheel is volume', (await until(async () => (await volumes(page)).includes(55))) && (await video(page)).rate === 1, json({ calls: await volumes(page), ...(await video(page)) }));
    await page.evaluate(() => scrollTo(0, 100));
    const volumeCalls = (await volumes(page)).length;
    await rightWheel(page);
    check('wheel: ...and the held button is speed', (await until(async () => (await video(page)).rate === 1.25)) && (await volumes(page)).length === volumeCalls, json({ calls: await volumes(page), ...(await video(page)) }));
    await page.close();
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

export async function live(t) {
  const { check, page } = t;
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  const facts = () => page.evaluate(() => { const v = document.querySelector('#movie_player video'); const p = document.querySelector('#movie_player'); return { time: v?.currentTime, muted: v?.muted, mark: v?.getAttribute('sieve-boost'), src: v?.src.slice(0, 5), volume: p?.getVolume?.(), pressed: document.querySelector('sieve-yt-row')?.shadowRoot.querySelector('[data-id="boost"] button')?.getAttribute('aria-pressed') }; }).catch(() => null);
  try {
    await setYouTube(t, { volume: { setDefault: true, level: 30, boostOn: false } });
    await page.goto(`https://www.youtube.com/watch?v=${t.videoId}`, { waitUntil: 'domcontentloaded' });
    const gate = await gated();
    if (gate) return console.log(`SKIP  volume live: ${gate}`);
    await page.waitForFunction(() => document.querySelector('sieve-yt-row') && document.querySelector('#movie_player video')?.currentTime > 2, null, { timeout: 40_000 }).catch(() => {});
    await sleep(1500);
    check('live volume: with a default of 30 the player\'s volume reads 30', (await facts())?.volume === 30, json(await facts()));
    await page.locator('sieve-yt-row').getByRole('button', { name: 'Boost volume' }).click({ timeout: 10_000 });
    const routed = await until(async () => (await facts())?.mark === 'running', 8000);
    const at = (await facts())?.time ?? 0;
    await page.waitForFunction((s) => document.querySelector('#movie_player video').currentTime > s + 5, at, { timeout: 30_000 }).catch(() => {});
    const f = await facts();
    check('live volume: after a click on "Boost volume" the video is routed (sieve-boost="running"), plays for 5 s and is not muted', routed && f.time > at + 5 && f.muted === false && f.src === 'blob:' && f.pressed === 'true', json({ routed, at, ...f }));
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube')).catch(() => {});
  }
}
