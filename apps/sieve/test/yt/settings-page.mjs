// Task 2.16: the settings page's YouTube section, its "YouTube tools" switch and the side navigation.
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { openYt, row, setYouTube, storedYouTube, until } from './helpers.mjs';

const CORE = new URL('../../../../packages/sieve-core/src/', import.meta.url).href;
const json = JSON.stringify;
const reset = (t) => t.sw.evaluate(() => chrome.storage.local.remove('youtube'));
const stored = async (t, path) => path.split('.').reduce((o, k) => o?.[k], await storedYouTube(t));
const storedIs = (t, path, want) => until(async () => json(await stored(t, path)) === json(want));

async function openOptions(t, hash = '#youtube', width = 800) {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(`options: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && t.errors.push(`options console: ${m.text()}`));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`chrome-extension://${t.id}/options.html${hash}`);
  await page.locator('#youtube').waitFor();
  return page;
}
const field = (page, path) => page.locator(`#youtube [data-path="${path}"]`);
const control = (page, path) => field(page, path).locator('input, select, textarea').first();
const switchNamed = (page, name) => page.locator('#youtube').getByRole('switch', { name, exact: true });
const rowShown = async (page) => (await row(page).count()) > 0 && !(await row(page).evaluate((el) => el.hidden));
const focusedPath = (page) => page.evaluate(() => document.activeElement?.closest('[data-path]')?.getAttribute('data-path') ?? null);

export async function local(t) {
  const { check } = t;
  const { YOUTUBE_GROUPS } = await import(`${CORE}youtube-settings.ts`);
  const experiments = await import(`${CORE}experiments.ts`).catch((e) => ({ error: String(e?.message ?? e).split('\n')[0] }));
  const presets = experiments.EXPERIMENT_PRESETS ?? [];
  check('settings-page: core has experiments.ts (EXPERIMENT_PRESETS, parseFlagOverrides)', !experiments.error, experiments.error ?? '');
  const fields = YOUTUBE_GROUPS.flatMap((g) => g.fields);
  const pages = [];
  try {
    await reset(t);
    const opt = await openOptions(t);
    pages.push(opt);

    const heading = opt.locator('#youtube').getByRole('heading', { level: 2, name: 'YouTube', exact: true });
    const inView = async () => {
      const box = await heading.boundingBox();
      return box !== null && box.y >= 0 && box.y < 900;
    };
    check('settings-page: options.html#youtube opens with the "YouTube" heading inside the viewport', await until(inView), json(await heading.boundingBox()));

    const controls = opt.locator('#youtube input, #youtube select, #youtube textarea');
    const count = await controls.count();
    check(`settings-page: the section has one control per field (${fields.length}) plus one per preset (${presets.length})`, fields.length === 54 && count === fields.length + presets.length, `${count} controls, ${fields.length} fields`);
    const first = controls.first();
    check('settings-page: the first control is the "YouTube tools" switch (field "on")', (await first.getAttribute('role')) === 'switch' && (await switchNamed(opt, 'YouTube tools').count()) === 1 && (await first.evaluate((el) => el.closest('[data-path]')?.getAttribute('data-path'))) === 'on');
    const want = { switch: 'checkbox', number: 'number', select: 'select', color: 'color', text: 'textarea' };
    const kinds = await Promise.all(fields.map(async (f) => ({ f, tag: await control(opt, f.path).evaluate((e) => (e.tagName === 'INPUT' ? e.type : e.tagName.toLowerCase())), role: await control(opt, f.path).getAttribute('role') })));
    check('settings-page: each field has the control of its kind (switch, number, select, color, textarea)', kinds.every((k) => k.tag === want[k.f.kind] && (k.f.kind !== 'switch' || k.role === 'switch')), json(kinds.filter((k) => k.tag !== want[k.f.kind]).map((k) => [k.f.path, k.tag])));
    const speed = control(opt, 'speed.default');
    check('settings-page: a number control carries min, max and step, and the unit follows it', (await speed.getAttribute('min')) === '0.1' && (await speed.getAttribute('max')) === '16' && (await speed.getAttribute('step')) === '0.05' && (await field(opt, 'speed.default').innerText()).includes('×'));
    check('settings-page: a text control carries maxlength', (await control(opt, 'theme.css').getAttribute('maxlength')) === '100000');
    if (presets.length) {
      const counts = await Promise.all(presets.map((p) => switchNamed(opt, `Block ${p.label}`).count()));
      check('settings-page: each preset is a switch labelled "Block " plus its label', counts.every((n) => n === 1), json(counts));
      const sw = switchNamed(opt, `Block ${presets[0].label}`);
      await sw.check();
      check('settings-page: turning a preset on stores its id in experiments.presets', await storedIs(t, 'experiments.presets', [presets[0].id]), json(await stored(t, 'experiments.presets')));
      await sw.uncheck();
      check('settings-page: and turning it off removes it', await storedIs(t, 'experiments.presets', []));
    } else {
      console.log('settings-page: EXPERIMENT_PRESETS is empty, so no preset switches were checked');
    }

    const fixture = await openYt(t, '/watch?v=sieveTest01');
    pages.push(fixture);
    check('settings-page: with YouTube tools on (the default) the fixture tab shows the row', await until(() => rowShown(fixture)));
    const tools = switchNamed(opt, 'YouTube tools');
    const rest = opt.locator('#youtube [inert]');
    const opacity = () => rest.first().evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
    check('settings-page: while on, nothing in the section is inert', (await rest.count()) === 0);
    await tools.uncheck();
    check('settings-page: turning YouTube tools off stores youtube.on === false', await storedIs(t, 'on', false), json(await storedYouTube(t)));
    check('settings-page: it makes every other control inert and greyed out (opacity 0.5)', (await rest.count()) === 1 && (await rest.locator('input, select, textarea').count()) === count - 1 && (await opacity()) === '0.5', `${await rest.count()} ${await opacity()}`);
    check('settings-page: the switch itself stays usable', !(await tools.evaluate((el) => !!el.closest('[inert]'))));
    check('settings-page: it hides the row in the open fixture tab', await until(async () => !(await rowShown(fixture))));
    await tools.check();
    check('settings-page: turning it on stores youtube.on === true', await storedIs(t, 'on', true));
    check('settings-page: it makes the controls usable again', await until(async () => (await rest.count()) === 0));
    check('settings-page: it shows the row again', await until(() => rowShown(fixture)));
    await fixture.close();

    await opt.bringToFront();
    const def = control(opt, 'speed.default');
    await def.fill('99');
    await def.press('Tab');
    check('settings-page: "Default speed" 99 then Tab stores 16', await storedIs(t, 'speed.default', 16), json(await stored(t, 'speed.default')));
    check('settings-page: and the input shows 16', await until(async () => (await def.inputValue()) === '16'), await def.inputValue());

    const live = await openYt(t, '/watch?v=sieveTest01', 'watch-full');
    pages.push(live);
    await until(() => rowShown(live));
    const commentsShown = () => live.evaluate(() => getComputedStyle(document.querySelector('ytd-comments')).display !== 'none');
    check('settings-page: the fixture tab shows its comments first', await commentsShown());
    await switchNamed(opt, 'Hide comments').check();
    check('settings-page: "Hide comments" stores tidy.hideComments === true', await storedIs(t, 'tidy.hideComments', true));
    check('settings-page: and the open fixture tab hides its comments without a reload (needs tidy, Task 2.12)', await until(async () => !(await commentsShown())));
    await switchNamed(opt, 'Hide comments').uncheck();
    await live.close();

    const other = await openOptions(t);
    pages.push(other);
    const step = control(opt, 'speed.step');
    await step.fill('0.5');
    await Promise.all([step.press('Tab'), switchNamed(other, 'Cinema mode').check()]);
    check('settings-page: two pages writing at once both land (Speed step 0.5, Cinema mode on)', (await storedIs(t, 'speed.step', 0.5)) && (await storedIs(t, 'player.cinema', true)), json(await storedYouTube(t)));
    check('settings-page: and each page follows the other', (await until(() => switchNamed(opt, 'Cinema mode').isChecked())) && (await until(async () => (await control(other, 'speed.step').inputValue()) === '0.5')));
    await other.close();

    const over = control(opt, 'experiments.overrides');
    await over.fill('a=1\nbad');
    await field(opt, 'experiments.overrides').getByRole('button', { name: 'Save', exact: true }).click();
    check('settings-page: saving "Flag overrides" with a bad line shows "Line 2: Write it as name=value."', await until(async () => (await field(opt, 'experiments.overrides').innerText()).includes('Line 2: Write it as name=value.')), await field(opt, 'experiments.overrides').innerText());
    check('settings-page: and stores the text as typed', await storedIs(t, 'experiments.overrides', 'a=1\nbad'), json(await stored(t, 'experiments.overrides')));

    await control(opt, 'volume.step').focus();
    await setYouTube(t, { tidy: { hideShorts: true }, speed: { wheel: 'off' }, player: { backdrop: '#123456' } });
    check('settings-page: a change from the worker updates the switch, select and colour control', (await until(() => switchNamed(opt, 'Hide Shorts').isChecked())) && (await until(async () => (await control(opt, 'speed.wheel').inputValue()) === 'off')) && (await until(async () => (await control(opt, 'player.backdrop').inputValue()) === '#123456')));
    check('settings-page: while another input keeps focus', (await focusedPath(opt)) === 'volume.step', String(await focusedPath(opt)));
    const css = control(opt, 'theme.css');
    await css.fill('x { }');
    await setYouTube(t, { theme: { css: 'y { }' }, experiments: { overrides: 'z=1' } });
    check('settings-page: a text area left alone follows the stored text', await until(async () => (await over.inputValue()) === 'z=1'), await over.inputValue());
    await sleep(300);
    check('settings-page: a text area the owner has edited keeps their text', (await css.inputValue()) === 'x { }', await css.inputValue());
    await field(opt, 'theme.css').getByRole('button', { name: 'Save', exact: true }).click();
    check('settings-page: and Save stores it', await storedIs(t, 'theme.css', 'x { }'));

    const nav = opt.getByRole('navigation');
    const ids = await opt.evaluate(() => [...document.querySelectorAll('#app section[id]')].map((s) => s.id));
    const links = await nav.getByRole('link').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]));
    check('settings-page: every section has an id, and the nav links to each of them in order', ids.length === (await opt.locator('#app section').count()) && json(links.map((l) => l[1])) === json(ids.map((i) => `#${i}`)), json({ ids, links }));
    check('settings-page: the nav starts with Blocking, Filter lists, My filters, Allowlist and YouTube', json(ids.slice(0, 5)) === '["blocking","lists","my-filters","allowlist","youtube"]' && json(links.slice(0, 5).map((l) => l[0])) === '["Blocking","Filter lists","My filters","Allowlist","YouTube"]', json(links));
    check('settings-page: the nav ends with Backup and import', links.at(-1)?.[0] === 'Backup and import' && links.at(-1)?.[1] === '#backup', json(links.at(-1)));
    const stacked = await opt.evaluate(() => ({ nav: document.querySelector('nav').getBoundingClientRect(), h2: document.querySelector('#blocking h2').getBoundingClientRect() }));
    check('settings-page: below 900 px the nav stacks above the content', stacked.nav.bottom <= stacked.h2.top, json(stacked));
    await nav.getByRole('link', { name: 'Allowlist', exact: true }).click();
    check('settings-page: a nav link scrolls to its section', await until(async () => { const b = await opt.locator('#allowlist h2').boundingBox(); return b !== null && b.y >= 0 && b.y < 300; }));

    const wide = await openOptions(t, '', 1200);
    pages.push(wide);
    const side = await wide.evaluate(() => {
      const n = document.querySelector('nav');
      return { position: getComputedStyle(n).position, navRight: n.getBoundingClientRect().right, contentLeft: document.querySelector('#blocking').getBoundingClientRect().left };
    });
    check('settings-page: at 900 px and above the nav is a sticky column left of the content', side.position === 'sticky' && side.navRight <= side.contentLeft, json(side));
    await wide.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const stuck = await wide.evaluate(() => document.querySelector('nav').getBoundingClientRect());
    check('settings-page: and it stays in view when the page scrolls', stuck.top >= 0 && stuck.bottom <= 900, json(stuck));
    await wide.close();

    await reset(t);
    await sleep(300);
    const shot = async (name) => {
      await opt.locator('#youtube').scrollIntoViewIfNeeded();
      await opt.locator('#youtube').screenshot({ path: join(t.shots, name) });
    };
    await opt.emulateMedia({ colorScheme: 'light' });
    await shot('settings-youtube-light.png');
    await opt.emulateMedia({ colorScheme: 'dark' });
    await sleep(400); // the switches fade between themes
    await shot('settings-youtube-dark.png');
    console.log(`settings-page screenshots: ${join(t.shots, 'settings-youtube-light.png')}, ${join(t.shots, 'settings-youtube-dark.png')}`);
    await opt.emulateMedia({ colorScheme: 'light' });
  } finally {
    for (const p of pages) await p.close().catch(() => {});
    await reset(t);
  }
}
