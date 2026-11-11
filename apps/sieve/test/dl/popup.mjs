import { join } from 'node:path';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { localGet, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(t) {
  const { check, fx } = t;
  if (!fx) return t.check('downloads: popup needs the fixture server', false);
  const problems = [];
  const host = await t.ctx.newPage();
  await host.goto(`${fx.base}/set-cookie`);
  const tabId = await t.sw.evaluate(async (u) => (await chrome.tabs.query({})).find((x) => x.url === u)?.id, `${fx.base}/set-cookie`);

  // Playwright can't click the toolbar button, so popup.html?tab=<id> stands in for it (as in the Phase 1 checks).
  const menu = async ({ colorScheme = 'light', downloads = true } = {}) => {
    const pop = await t.ctx.newPage();
    pop.on('pageerror', (e) => problems.push(e.message));
    pop.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await pop.emulateMedia({ colorScheme });
    await pop.setViewportSize({ width: 340, height: 700 });
    await pop.goto(`chrome-extension://${t.id}/popup.html?tab=${tabId}`);
    await pop.locator('footer').waitFor();
    if (downloads) await pop.getByRole('tab', { name: T.sectionTitle }).click();
    return pop;
  };
  const panel = (pop) => pop.locator('[data-id=downloads-panel]');
  const fresh = async (patch = {}) => {
    fx.reset();
    await resetDl(t);
    if (Object.keys(patch).length) await setDownloads(t, patch);
  };
  const add = async (path, extra = {}) => {
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ url: `${fx.base}${path}`, source: 'manual', ...extra }] });
    if (!reply?.ok) throw new Error(`dl-add failed: ${json(reply)}`);
    return reply.ids[0];
  };
  const stateOf = async (id) => (await readRecords(t)).find((r) => r.id === id)?.state;
  const reach = (id, state, ms = 20000) => until(async () => (await stateOf(id)) === state, ms);
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: popup: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };

  await attempt('tab bar', async () => {
    await fresh();
    const pop = await menu({ downloads: false });
    const names = await pop.locator('[role=tablist] [role=tab]').allInnerTexts();
    const selected = await pop.locator('[role=tab][aria-selected=true]').allInnerTexts();
    const blocking = (await pop.locator('[data-id=enabled]').count()) === 1 && (await pop.locator('[data-id=site]').count()) === 1 && (await pop.locator('[data-id=distraction]').count()) === 1;
    check('downloads: popup: the menu has the tabs Blocking and Downloads and opens on Blocking', JSON.stringify(names) === JSON.stringify(['Blocking', T.sectionTitle]) && JSON.stringify(selected) === '["Blocking"]' && blocking && (await panel(pop).count()) === 0, json({ names, selected, blocking }));
    await pop.getByRole('tab', { name: T.sectionTitle }).click();
    await panel(pop).waitFor();
    check('downloads: popup: pressing Downloads shows the panel, and the header switch stays', (await pop.locator('[data-id=enabled]').count()) === 1 && (await pop.locator('[data-id=distraction]').count()) === 0, '');
    await pop.close();
  });

  await attempt('empty and switch', async () => {
    await fresh();
    const pop = await menu();
    const p = panel(pop);
    await p.getByText(T.menuNone, { exact: true }).waitFor();
    const on = await p.locator('[data-id=downloads-on]').isChecked();
    const buttons = (await p.getByRole('button', { name: T.menuAdd, exact: true }).count()) === 1 && (await p.getByRole('button', { name: T.menuSeeAll, exact: true }).count()) === 1;
    check('downloads: popup: with no records the panel shows the empty line, the switch is on, and Add URL and Open download list are there', on && buttons && (await p.locator('.dl-row').count()) === 0, json({ on, buttons }));
    check('downloads: popup: the off line is not shown while downloads are on', !(await p.getByText(T.menuOff, { exact: true }).isVisible()), '');
    await p.locator('[data-id=downloads-on]').uncheck();
    await p.getByText(T.menuOff, { exact: true }).waitFor();
    const stored = await until(async () => (await localGet(t, 'downloads')).downloads?.on === false, 5000).catch(() => false);
    check('downloads: popup: turning the switch off stores on: false and shows the off line', stored, '');
    await p.locator('[data-id=downloads-on]').check();
    await p.getByText(T.menuOff, { exact: true }).waitFor({ state: 'hidden' });
    const back = await until(async () => (await localGet(t, 'downloads')).downloads?.on === true, 5000).catch(() => false);
    check('downloads: popup: turning it on again removes the line and stores on: true', back, '');
    await pop.close();
  });

  await attempt('active list', async () => {
    const main = { id: 'main', name: 'Main queue', maxParallel: 1, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } };
    await fresh({ queues: [main] });
    const a = await add('/file/40000000/a1.bin?rate=2000000');
    await until(async () => (await readRecords(t)).find((r) => r.id === a)?.parts?.some((p) => p.done > 0), 15000);
    const b = await add('/file/40000000/b1.bin?rate=2000000');
    const c = await add('/file/40000000/c1.bin?rate=2000000');
    await sendMsg(t, { type: 'dl-do', op: 'pause', ids: [c] });
    await reach(c, 'paused');
    const states = [await stateOf(a), await stateOf(b), await stateOf(c)];
    const pop = await menu();
    const p = panel(pop);
    await p.locator('.dl-row').nth(2).waitFor();
    const order = await p.locator('.dl-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    check('downloads: popup: three records (running, queued, paused) are listed, running first', JSON.stringify(states) === '["running","queued","paused"]' && JSON.stringify(order) === JSON.stringify([a, b, c]), json({ states, order, ids: [a, b, c] }));
    const row = p.locator(`.dl-row[data-id=${a}]`);
    const read = () => row.locator('progress').evaluate((el) => el.value);
    const first = await read();
    const grew = await until(async () => (await read()) > first, 8000).catch(() => false);
    const speed = await until(async () => /\/s$/.test(await row.locator('.dl-speed').innerText()), 8000).catch(() => false);
    check('downloads: popup: the running row advances live and shows a speed', grew && speed, json({ first, now: await read(), speed: await row.locator('.dl-speed').innerText() }));
    await pop.screenshot({ path: join(t.shots, 'dl-menu-light.png'), fullPage: true });
    await pop.emulateMedia({ colorScheme: 'dark' });
    await sleep(400);
    await pop.screenshot({ path: join(t.shots, 'dl-menu-dark.png'), fullPage: true });
    await pop.emulateMedia({ colorScheme: 'light' });

    await row.getByRole('button', { name: T.pause, exact: true }).click();
    await row.getByRole('button', { name: T.resume, exact: true }).waitFor();
    check('downloads: popup: pressing Pause makes the row say Resume and the record paused', (await reach(a, 'paused').then(() => true, () => false)), json(await stateOf(a)));
    await row.getByRole('button', { name: T.resume, exact: true }).click();
    const running = await until(async () => (await stateOf(a)) === 'running', 10000).catch(() => false);
    check('downloads: popup: pressing Resume runs the record again', running, json(await stateOf(a)));

    for (const n of ['d1', 'e1', 'f1']) await add(`/file/40000000/${n}.bin?rate=2000000`);
    await until(async () => (await p.locator('.dl-row').count()) === 5, 8000).catch(() => {});
    await sleep(600);
    check('downloads: popup: six active records show at most five rows', (await p.locator('.dl-row').count()) === 5, String(await p.locator('.dl-row').count()));
    const text = (await p.innerText()).toLowerCase();
    check('downloads: popup: the panel has no media section', !text.includes('media') && !text.includes('found on this page'), text);
    await pop.close();
  });

  await attempt('add', async () => {
    await fresh();
    const pop = await menu();
    const p = panel(pop);
    const box = p.getByLabel(T.addLabel);
    check('downloads: popup: the box is hidden until Add URL is pressed', !(await box.isVisible()), '');
    await p.getByRole('button', { name: T.menuAdd, exact: true }).click();
    await box.fill(`${fx.base}/file/3000000/m1.bin\nnot a url`);
    await p.getByRole('button', { name: T.addSubmit, exact: true }).click();
    await p.getByText(T.addSkipped(1), { exact: true }).waitFor();
    const records = await until(async () => {
      const r = await readRecords(t);
      return r.length === 1 && r;
    }, 8000).catch(async () => readRecords(t));
    check('downloads: popup: one good line and one bad line add one manual record and show the skipped line', records.length === 1 && records[0].source === 'manual' && records[0].name === 'm1.bin' && (await box.inputValue()) === '', json(records.map((r) => [r.name, r.source])));
    await box.fill('not a url');
    await p.getByRole('button', { name: T.addSubmit, exact: true }).click();
    await p.getByText(T.addNone, { exact: true }).waitFor();
    check('downloads: popup: only a bad line shows the none line and adds nothing', (await readRecords(t)).length === 1, '');
    await box.fill(Array.from({ length: 501 }, (_, i) => `${fx.base}/file/1000/n${i}.bin`).join('\n'));
    await p.getByRole('button', { name: T.addSubmit, exact: true }).click();
    await p.getByText(T.addTooMany, { exact: true }).waitFor();
    check('downloads: popup: more than 500 lines show the too-many line and add nothing', (await readRecords(t)).length === 1 && (await box.inputValue()) !== '', '');
    await pop.close();
  });

  await attempt('see all', async () => {
    await fresh();
    const list = () =>
      t.sw.evaluate(async (base) => {
        const ctxs = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter((c) => c.documentUrl?.startsWith(base));
        return Promise.all(ctxs.map(async (c) => [c.tabId, (await chrome.tabs.get(c.tabId)).active]));
      }, `chrome-extension://${t.id}/downloads.html`);
    const pop = await menu();
    await panel(pop).getByRole('button', { name: T.menuSeeAll, exact: true }).click();
    const one = await until(async () => {
      const l = await list();
      return l.length === 1 && l;
    }, 8000).catch(list);
    // A second press focuses that tab instead of opening another.
    await host.bringToFront();
    const pop2 = await menu();
    await panel(pop2).getByRole('button', { name: T.menuSeeAll, exact: true }).click();
    const two = await until(async () => {
      const l = await list();
      return l.length === 1 && l[0][1] && l;
    }, 8000).catch(list);
    const diag = { closed: pop.isClosed(), note: pop.isClosed() ? null : await pop.locator('.dl-note').innerText().catch(() => null), all: await t.sw.evaluate(async () => (await chrome.tabs.query({})).map((x) => x.url)) };
    check('downloads: popup: Open download list opens downloads.html once and a second press focuses the same tab', one.length === 1 && two.length === 1 && two[0][0] === one[0][0] && two[0][1], json({ one, two, diag }));
    for (const x of [pop, pop2]) await x.close().catch(() => {});
    await t.ctx.pages().find((x) => x.url().endsWith('/downloads.html'))?.close();
  });

  check('downloads: popup: the menu logged no error', problems.length === 0, json(problems));
  await host.close();
  await resetDl(t);
}
