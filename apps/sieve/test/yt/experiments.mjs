// Task 2.14: the experiments manager. The fixture (test/pages/yt/experiments.html) reproduces the config mechanism inspected on the real page.
import { setTimeout as sleep } from 'node:timers/promises';
import { openYt, setYouTube, until } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const READ = () => window.__read();
const ORIGINAL = { flag: true, serialized: 'sieve_test_flag=true&other=1' };
const patched = (page) => until(async () => (await page.evaluate(READ)).flag === false, 4000);

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await setYouTube(t, { experiments: { overrides: 'sieve_test_flag=false' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'experiments');
    await sleep(900);
    const reads = await page.evaluate(() => window.__reads);
    check('experiments: what the "player" reads after load is patched (flag false, serialized string patched, the other flag kept)', json(reads) === json([{ flag: false, serialized: 'sieve_test_flag=false&other=1' }]), json(reads));
    const other = await page.evaluate(() => ({ other: ytcfg.get('EXPERIMENT_FLAGS').other, type: typeof ytcfg.get, same: ytcfg.get('EXPERIMENT_FLAGS') === ytcfg.d().EXPERIMENT_FLAGS }));
    check('experiments: other flags are untouched, and the replaced ytcfg object still works', json(other) === '{"other":1,"type":"function","same":true}', json(other));
    const listed = await page.evaluate(() => ({ key: Object.keys(window).includes('ytcfg'), enumerable: Object.prototype.propertyIsEnumerable.call(window, 'ytcfg') }));
    check('experiments: once the page has written ytcfg it is an enumerable window key (Object.keys, for...in), as without Sieve', listed.key && listed.enumerable, json(listed));

    await page.evaluate(() => window.__write());
    check('experiments: a later config write is patched too', json(await page.evaluate(READ)) === json({ flag: false, serialized: 'sieve_test_flag=false&other=1' }), json(await page.evaluate(READ)));
    await page.close();

    await setYouTube(t, { on: false, experiments: { overrides: 'sieve_test_flag=false' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'experiments');
    await sleep(900);
    check('experiments: with YouTube tools off nothing is changed', json((await page.evaluate(() => window.__reads))[0]) === json(ORIGINAL), json(await page.evaluate(() => window.__reads)));
    await page.close();

    await setYouTube(t, { on: true, experiments: { overrides: '' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'experiments');
    await sleep(900);
    check('experiments: with no overrides nothing is changed', json((await page.evaluate(() => window.__reads))[0]) === json(ORIGINAL), json(await page.evaluate(() => window.__reads)));
    await setYouTube(t, { experiments: { overrides: 'sieve_test_flag=false' } });
    check('experiments: a settings change patches the objects the page already holds', await patched(page), json(await page.evaluate(READ)));
    check('experiments: and the serialized string follows', (await page.evaluate(READ)).serialized === 'sieve_test_flag=false&other=1', json(await page.evaluate(READ)));
    await page.close();

    await setYouTube(t, { experiments: { presets: ['modern-player', 'unknown'], overrides: 'x=1\nbad line' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'experiments');
    await sleep(900);
    const preset = (await page.evaluate(() => window.__reads))[0];
    check('experiments: a preset adds its flag, an unknown preset and a bad line are skipped, the text flags are added', preset?.serialized === 'sieve_test_flag=true&other=1&delhi_modern_web_player=false&x=1' && preset?.flag === true, json(preset));
    await page.close();

    await setYouTube(t, { experiments: { presets: ['modern-player'], overrides: 'delhi_modern_web_player=true' } });
    page = await openYt(t, '/watch?v=sieveTest01', 'experiments');
    await sleep(900);
    check('experiments: the text wins over a preset', (await page.evaluate(() => window.__reads))[0]?.serialized === 'sieve_test_flag=true&other=1&delhi_modern_web_player=true', json(await page.evaluate(() => window.__reads)));
    await page.close();

    await setYouTube(t, { experiments: { presets: [], overrides: 'sieve_test_flag=false' } });
    page = await openYt(t, '/watch?v=sieveTest01');
    await sleep(500);
    check('experiments: the watch fixture without a config page has no ytcfg and no page error', (await page.evaluate(() => typeof window.ytcfg)) === 'undefined');
    await page.close();

    for (const odd of ['frozen', 'getter', 'throws']) {
      const errors = t.errors.length;
      page = await openYt(t, `/watch?v=sieveTest01&odd=${odd}`, 'experiments');
      await sleep(900);
      const result = await page.evaluate(() => ({ done: window.__oddDone === true, read: window.__reads.length === 1 && window.__reads[0].flag === false }));
      check(`experiments: a page that assigns a ytcfg that is ${odd} still finishes its script, raises no page error, and its later config is patched`, result.done && result.read && t.errors.length === errors, json({ result, errors: t.errors.slice(errors) }));
      await page.close();
    }
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
  }
}

// Marker recorded in src/yt/experiments-main.ts and the core presets: class ytp-delhi-modern on #movie_player is the modern look.
export async function live(t) {
  const { check, page } = t;
  const state = () => page.evaluate(() => {
    const p = document.querySelector('#movie_player');
    const ser = ytcfg.get('WEB_PLAYER_CONTEXT_CONFIGS')?.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH?.serializedExperimentFlags ?? '';
    return { modern: p?.classList.contains('ytp-delhi-modern') ?? null, ser: /(?:^|&)delhi_modern_web_player=([^&]*)/.exec(ser)?.[1] ?? null, bar: getComputedStyle(document.querySelector('.ytp-chrome-bottom') ?? document.body).height };
  }).catch(() => null);
  const ready = () => page.waitForFunction(() => typeof document.querySelector('#movie_player')?.getPlayerState === 'function' && document.querySelector('#movie_player video')?.readyState >= 1, null, { timeout: 30_000 }).catch(() => {});
  const gated = () => page.evaluate(() => ({ bot: /confirm you.re not a bot/i.test(document.body?.innerText ?? ''), consent: location.hostname.startsWith('consent.') })).then((g) => (g.bot ? 'bot check' : g.consent ? 'consent page' : null), () => null);
  try {
    await ready();
    const gate = await gated();
    if (gate) return console.log(`SKIP  experiments live: ${gate}`);
    const before = await state();
    if (!before?.modern) return console.log(`SKIP  experiments live: this page does not show the modern player without the preset (${json(before)}), so there is nothing to block`);
    await setYouTube(t, { experiments: { presets: ['modern-player'] } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await sleep(2500);
    const after = await state();
    check('live experiments: with the modern-player preset the serialized flag reads false and #movie_player has no ytp-delhi-modern', after?.ser === 'false' && after?.modern === false, json(after));
    check('live experiments: the controls bar is the older, shorter one (48 px, not 56)', after?.bar === '48px', json({ before, after }));
    await page.mouse.move(420, 320);
    await sleep(500);
    const box = await page.locator('#movie_player').boundingBox();
    await page.screenshot({ path: `${t.shots}/yt-experiments.png`, clip: box ?? undefined });
    await setYouTube(t, { experiments: { presets: [] } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await sleep(2500);
    const back = await state();
    check('live experiments: clearing the preset brings the modern player back on the next load', back?.modern === true && back?.ser === 'true', json(back));
  } finally {
    await t.sw.evaluate(() => chrome.storage.local.remove('youtube')).catch(() => {});
  }
}
