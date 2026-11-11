import { ERRORS, newRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import { CATEGORY_IDS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { extPage, localGet, opfsNames, readRecords, resetDl, sendMsg, sessionGet, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 400);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowsOf = (page) =>
  page.evaluate(() => [...document.querySelectorAll('tbody tr')].map((tr) => ({ id: tr.dataset.id, name: tr.querySelector('.dl-name').textContent, status: tr.querySelector('.dl-status').textContent, selected: tr.getAttribute('aria-selected'), bar: tr.querySelector('progress').value })));
const namesOf = async (page) => (await rowsOf(page)).map((r) => r.name);
const bar = (page, label) => page.locator(`[role=toolbar] button[data-id=${label}]`);

export async function run(t) {
  if (!t.fx) return t.check('downloads: list needs the fixture server', false);
  const { check, fx } = t;
  const file = (size, name, query = '') => `${fx.base}/file/${size}/${name}${query}`;
  const slow = (name, rate = 1000000) => file(40_000_000, name, `?rate=${rate}`);
  const pages = [];
  const open = async (hash = '') => {
    const page = await extPage(t, `downloads.html${hash}`);
    pages.push(page);
    return page;
  };
  const fresh = async (patch = {}) => {
    for (const p of pages.splice(0)) await p.close();
    fx.reset();
    await resetDl(t);
    if (Object.keys(patch).length) await setDownloads(t, patch);
  };
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: list: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  // Records the page reads on first paint without an engine: written into sieve-dl, then the page reloads.
  const seed = async (page, specs) => {
    const records = specs.map(([name, over = {}], i) => {
      const category = over.category ?? 'other';
      const r = newRecord({ url: file(1000, name), referrer: '', name, category, categoryFixed: false, queue: 'main', source: 'manual', partsWanted: 1 }, Date.now() + i, `dseed${Date.now().toString(36)}${i}x${name.length}`);
      return { ...r, state: 'paused', size: 1000, rangeOk: true, ...over };
    });
    await page.evaluate(async (recs) => {
      const db = await new Promise((ok, fail) => {
        const o = indexedDB.open('sieve-dl', 1);
        o.onupgradeneeded = () => (o.result.createObjectStore('records', { keyPath: 'id' }), o.result.createObjectStore('meta'));
        o.onsuccess = () => ok(o.result);
        o.onerror = () => fail(o.error);
      });
      const tx = db.transaction('records', 'readwrite');
      for (const r of recs) tx.objectStore('records').put(r);
      await new Promise((ok) => (tx.oncomplete = ok));
      db.close();
    }, records);
    await page.reload();
    await until(async () => (await rowsOf(page)).length === records.length, 30000);
    return records;
  };
  const errorsBefore = t.errors.length;

  await attempt('shell', async () => {
    await fresh();
    const page = await open();
    check('downloads: list: the title is T.listTitle', (await page.title()) === T.listTitle, await page.title());
    check('downloads: list: the toolbar buttons are the six texts in order', same(await page.locator('[role=toolbar] button').allTextContents(), [T.addUrl, T.resume, T.pause, T.delete, T.speedLimit, T.scheduler]), json(await page.locator('[role=toolbar] button').allTextContents()));
    check('downloads: list: the column headers are the five texts', same(await page.locator('th button').allTextContents(), [T.colName, T.colSize, T.colProgress, T.colSpeed, T.colEta]));
    const labels = await page.locator('nav .dl-label').allTextContents();
    check('downloads: list: the sidebar lists three filters, six categories and the queue', same(labels, [T.navAll, T.navUnfinished, T.navFinished, ...CATEGORY_IDS.map((id) => T.categoryNames[id]), 'Main queue']), json(labels));
    check('downloads: list: an empty profile shows T.emptyAll', (await page.locator('.dl-empty').textContent()) === T.emptyAll && (await page.locator('.dl-empty').isVisible()));
    check('downloads: list: with no selection Resume, Pause and Delete are disabled', (await Promise.all(['resume', 'pause', 'delete'].map((b) => bar(page, b).isDisabled()))).every(Boolean));
  });

  await attempt('add', async () => {
    await fresh({ queues: [{ id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }, { id: 'q2', name: 'Night', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }] });
    const page = await open();
    await bar(page, 'add').click();
    check('downloads: list: Add opens the dialog named T.addTitle', (await page.locator('dialog[open]').getAttribute('aria-labelledby')) !== null && (await page.locator('dialog[open] h2').textContent()) === T.addTitle);
    await page.fill('#dl-add-text', `${slow('one.bin')}\n${slow('two.bin')}\nnot a url`);
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await page.waitForSelector('dialog', { state: 'detached' });
    check('downloads: list: the status line shows T.addSkipped(1)', (await page.locator('#dl-status').textContent()) === T.addSkipped(1));
    await until(async () => (await rowsOf(page)).length === 2);
    check('downloads: list: two rows appear', same((await namesOf(page)).sort(), ['one.bin', 'two.bin']), json(await namesOf(page)));

    await bar(page, 'add').click();
    await page.fill('#dl-add-text', 'not a url');
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    check('downloads: list: only an invalid line keeps the dialog open with T.addNone', (await page.locator('dialog[open] [role=alert]').textContent()) === T.addNone);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog', { state: 'detached' });
    check('downloads: list: Esc closes without adding', (await readRecords(t)).length === 2);

    await bar(page, 'add').click();
    await page.fill('#dl-add-text', slow('three.zip'));
    await page.selectOption('#dl-add-queue', 'q2');
    await page.selectOption('#dl-add-category', 'archives');
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    const added = await until(async () => (await readRecords(t)).find((r) => r.name === 'three.zip'));
    check('downloads: list: the chosen queue and category are set and fixed', added.queue === 'q2' && added.category === 'archives' && added.categoryFixed === true && added.source === 'manual', json(added));
  });

  await attempt('live rows', async () => {
    await fresh();
    const page = await open();
    await page.locator('[data-id=add]').click();
    await page.fill('#dl-add-text', file(40_000_000, 'live.bin', '?rate=8000000'));
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await until(async () => (await rowsOf(page)).length === 1);
    await page.evaluate(() => (window.__row = document.querySelector('tbody tr')));
    const first = await until(async () => (await rowsOf(page))[0]?.bar > 0 && (await rowsOf(page))[0]);
    await new Promise((r) => setTimeout(r, 1500));
    const second = (await rowsOf(page))[0];
    const kept = await page.evaluate(() => window.__row === document.querySelector('tbody tr'));
    check('downloads: list: the progress grows between two reads while the row is the same node', second.bar > first.bar && kept, json({ first: first.bar, second: second.bar, kept }));
    const cells = await page.evaluate(() => [...document.querySelectorAll('tbody tr td')].map((td) => td.textContent));
    check('downloads: list: size, speed and time left cells fill in', cells[2] === '40 MB' && /\/s$/.test(cells[4]) && cells[5] !== '', json(cells));
    check('downloads: list: the header shows the total speed', /\/s$/.test((await page.locator('.dl-total').textContent()) ?? '') && (await page.locator('.dl-total').isVisible()));
  });

  await attempt('sorting and filters', async () => {
    await fresh();
    const page = await open();
    await seed(page, [['b.bin', { size: 2000 }], ['A.bin', { size: 500 }], ['c.bin', { size: null }], ['p.zip', { category: 'archives' }], ['q.mp4', { category: 'video' }], ['r.pdf', { category: 'documents' }]]);
    await until(async () => (await rowsOf(page)).length === 6);
    check('downloads: list: the default order is newest first', same(await namesOf(page), ['r.pdf', 'q.mp4', 'p.zip', 'c.bin', 'A.bin', 'b.bin']), json(await namesOf(page)));
    await page.click('[data-filter="cat:archives"]');
    check('downloads: list: the Archives filter shows one row and is current', same(await namesOf(page), ['p.zip']) && (await page.locator('[data-filter="cat:archives"]').getAttribute('aria-current')) === 'true');
    await page.click('[data-filter=finished]');
    check('downloads: list: Finished shows T.emptyFiltered while nothing is done', (await page.locator('.dl-empty').textContent()) === T.emptyFiltered && (await page.locator('.dl-empty').isVisible()));
    await page.click('[data-filter=unfinished]');
    check('downloads: list: Unfinished lists all six', (await rowsOf(page)).length === 6);
    await page.click('[data-filter="queue:main"]');
    check('downloads: list: the queue filter lists them all', (await rowsOf(page)).length === 6);
    await page.click('[data-filter=all]');

    const sortBy = async (label) => (await page.locator('th button', { hasText: label }).click(), (await namesOf(page)).filter((n) => /^[A-Za-z]\.bin$/.test(n)));
    const asc = await sortBy(T.colName);
    check('downloads: list: Name sorts A.bin, b.bin, c.bin with aria-sort ascending', same(asc, ['A.bin', 'b.bin', 'c.bin']) && (await page.locator('th', { has: page.locator('button', { hasText: T.colName }) }).getAttribute('aria-sort')) === 'ascending', json(asc));
    check('downloads: list: a second click reverses it', same(await sortBy(T.colName), ['c.bin', 'b.bin', 'A.bin']));
    const sizeAsc = await sortBy(T.colSize);
    const sizeDesc = await sortBy(T.colSize);
    check('downloads: list: Size puts the unknown size last in both directions', sizeAsc.at(-1) === 'c.bin' && sizeDesc.at(-1) === 'c.bin', json({ sizeAsc, sizeDesc }));

    await page.click('[data-filter=all]');
    await page.locator('tbody tr').first().click();
    await page.locator('tbody tr').nth(2).click({ modifiers: ['Shift'] });
    check('downloads: list: Shift-click selects the range', (await rowsOf(page)).filter((r) => r.selected === 'true').length === 3);
    await page.locator('tbody tr').nth(4).click({ modifiers: ['ControlOrMeta'] });
    check('downloads: list: Ctrl or Cmd-click toggles one row', (await rowsOf(page)).filter((r) => r.selected === 'true').length === 4);
    await page.locator('tbody tr').nth(5).click();
    check('downloads: list: a plain click selects only that row', (await rowsOf(page)).filter((r) => r.selected === 'true').length === 1);
    const label = await page.locator('tbody tr').nth(5).locator('input').getAttribute('aria-label');
    check('downloads: list: the checkbox is named with the file name', label === T.selectRow((await namesOf(page))[5]), label);
    await page.locator('tbody tr').nth(0).locator('input').click();
    check('downloads: list: the checkbox toggles without clearing the others', (await rowsOf(page)).filter((r) => r.selected === 'true').length === 2);
    await page.locator('[data-id=delete]').click();
    check('downloads: list: deleting two unfinished rows reads T.confirmDeleteUnfinished(2)', (await page.locator('dialog[open] p').textContent()) === T.confirmDeleteUnfinished(2));
    await page.click(`dialog button:text-is("${T.cancel}")`);
    check('downloads: list: Cancel keeps the rows', (await rowsOf(page)).length === 6);
  });

  await attempt('pause, resume, delete', async () => {
    await fresh();
    const page = await open();
    await page.locator('[data-id=add]').click();
    await page.fill('#dl-add-text', slow('pr.bin', 2000000));
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await until(async () => (await rowsOf(page))[0]?.status === T.st.downloading && (await rowsOf(page))[0].bar > 0);
    await page.locator('tbody tr').first().click();
    await bar(page, 'pause').click();
    await until(async () => (await rowsOf(page))[0]?.status === T.st.paused);
    check('downloads: list: Pause makes the status T.st.paused', true);
    const asked = fx.log.filter((l) => l.path.endsWith('/pr.bin') && !l.closed).length;
    await bar(page, 'resume').click();
    await until(async () => (await rowsOf(page))[0]?.status === T.st.downloading);
    const fresh1 = await until(async () => fx.log.filter((l) => l.path.endsWith('/pr.bin') && !l.closed).slice(asked).find((l) => /^bytes=\d+-/.test(l.range ?? '')));
    check('downloads: list: Resume runs it again and the next request starts above 0', Number(/^bytes=(\d+)-/.exec(fresh1.range)[1]) > 0, json(fresh1));
    const id = (await rowsOf(page))[0].id;
    await bar(page, 'delete').click();
    check('downloads: list: Delete asks T.confirmDeleteUnfinished(1) with T.confirmDelete', (await page.locator('dialog[open] p').textContent()) === T.confirmDeleteUnfinished(1) && (await page.locator(`dialog[open] button:text-is("${T.confirmDelete}")`).count()) === 1);
    await page.click(`dialog button:text-is("${T.cancel}")`);
    check('downloads: list: Cancel keeps the row', (await rowsOf(page)).length === 1);
    await bar(page, 'delete').click();
    await page.click(`dialog button:text-is("${T.confirmDelete}")`);
    await until(async () => (await rowsOf(page)).length === 0);
    await until(async () => !(await opfsNames(t)).includes(`${id}.part`));
    check('downloads: list: Delete removes the row and its private file', (await readRecords(t)).length === 0);
  });

  await attempt('failed row', async () => {
    await fresh();
    const page = await open();
    await seed(page, [['retry.bin', { state: 'failed', error: ERRORS.changed, url: file(3000, 'retry.bin') }]]);
    const r = (await rowsOf(page))[0];
    check('downloads: list: a failed row shows its sentence and T.retryInChrome', r.status === ERRORS.changed && (await page.locator('.dl-retry').textContent()) === T.retryInChrome, json(r));
    await page.click('.dl-retry');
    await until(async () => (await rowsOf(page)).length === 0, 20000);
    check('downloads: list: Retry in Chrome makes Chrome fetch the file and removes the row', fx.log.some((l) => l.path.endsWith('/retry.bin') && !l.closed), json(fx.log.slice(-3)));
  });

  await attempt('done row', async () => {
    await fresh();
    const page = await open();
    await page.locator('[data-id=add]').click();
    await page.fill('#dl-add-text', file(200_000, 'done.zip'));
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await until(async () => (await rowsOf(page))[0]?.status === T.st.done('Archives'), 40000);
    await until(async () => (await page.locator('.dl-show').count()) === 1);
    check('downloads: list: a finished row shows T.st.done and T.showInFolder', (await page.locator('.dl-show').textContent()) === T.showInFolder);
    const before = t.errors.length;
    await page.click('.dl-show');
    check('downloads: list: Show in folder raises no page error', t.errors.length === before);
  });

  await attempt('off switch', async () => {
    await fresh({ on: false });
    const page = await open();
    await seed(page, [['off.bin', { url: slow('off.bin', 2000000), size: 40_000_000 }]]);
    check('downloads: list: Off shows T.offBanner and T.turnOn', (await page.locator('.dl-banner').isVisible()) && (await page.locator('.dl-banner p').textContent()) === T.offBanner && (await page.locator('.dl-banner button').textContent()) === T.turnOn);
    await page.locator('tbody tr').first().click();
    await bar(page, 'resume').click();
    await until(async () => (await rowsOf(page))[0]?.status === T.st.downloading, 20000);
    check('downloads: list: a paused record still resumes and runs while Downloads is off', true);
    await page.click(`.dl-banner button:text-is("${T.turnOn}")`);
    await until(async () => (await localGet(t, 'downloads')).downloads?.on === true);
    check('downloads: list: Turn on removes the banner and stores on: true', !(await page.locator('.dl-banner').isVisible()));
  });

  await attempt('prefill', async () => {
    await fresh();
    const referrer = `${fx.base}/some-page`;
    await t.sw.evaluate((v) => chrome.storage.session.set({ dlPrefill: v }), { urls: [slow('menu1.bin'), slow('menu2.bin')], referrer });
    const page = await open('#add');
    await page.waitForSelector('dialog[open]');
    const text = await page.inputValue('#dl-add-text');
    check('downloads: list: #add opens the dialog with the URLs one per line', text === `${slow('menu1.bin')}\n${slow('menu2.bin')}`, text);
    check('downloads: list: dlPrefill is deleted', (await sessionGet(t, 'dlPrefill')).dlPrefill === undefined);
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await until(async () => (await readRecords(t)).length === 2);
    const rs = await readRecords(t);
    check('downloads: list: the records have source menu and the referrer', rs.every((r) => r.source === 'menu' && r.referrer === referrer), json(rs.map((r) => [r.source, r.referrer])));
    const page2 = await open('#add');
    await page2.waitForSelector('dialog[open]');
    check('downloads: list: #add without a prefill opens an empty dialog', (await page2.inputValue('#dl-add-text')) === '');
  });

  await attempt('review fixes', async () => {
    await fresh();
    let page = await open();
    await seed(page, [['sv.bin', { state: 'saving', saveOnly: true }]]);
    await page.locator('tbody tr').first().click();
    check('downloads: list: Delete is disabled while a selected row is saving', await bar(page, 'delete').isDisabled());

    await fresh();
    page = await open();
    await seed(page, [['f1.bin']]);
    await page.locator('tbody tr').first().locator('input').focus();
    await page.evaluate(() => (window.__box = document.activeElement));
    await sendMsg(t, { type: 'dl-add', items: [{ url: slow('f2.bin'), source: 'manual' }] });
    await until(async () => (await rowsOf(page)).length === 2);
    const kept1 = await page.evaluate(() => document.activeElement === window.__box);
    await new Promise((r) => setTimeout(r, 2600));
    const kept2 = await page.evaluate(() => document.activeElement === window.__box);
    check('downloads: list: a re-order keeps the focused checkbox focused', kept1 && kept2, json({ kept1, kept2 }));

    await fresh();
    await t.sw.evaluate((v) => chrome.storage.session.set({ dlPrefill: v }), { urls: [slow('file-ref.bin')], referrer: 'file:///page.html' });
    page = await open('#add');
    await page.waitForSelector('dialog[open]');
    check('downloads: list: #add is removed from the address after it is read', !page.url().includes('#add'), page.url());
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    await until(async () => (await readRecords(t)).length === 1);
    check('downloads: list: a non-http referrer is dropped and the add still works', (await readRecords(t))[0].referrer === '');

    await bar(page, 'add').click();
    await page.fill('#dl-add-text', Array.from({ length: 501 }, (_, i) => `http://localhost:9/a${i}.bin`).join('\n'));
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    check('downloads: list: more than 500 addresses keeps the dialog open with T.addTooMany', (await page.locator('dialog[open] [role=alert]').textContent()) === T.addTooMany && (await readRecords(t)).length === 1);
    await page.keyboard.press('Escape');
  });

  await attempt('delete safety and chunks', async () => {
    await fresh();
    let page = await open();
    const [rec] = await seed(page, [['turns-saving.bin']]);
    await page.locator('tbody tr').first().click();
    await bar(page, 'delete').click();
    await sendMsg(t, { type: 'dl-state', records: [{ ...rec, state: 'saving', saveOnly: true }], removed: [], speeds: {}, total: 0 });
    await until(async () => (await rowsOf(page))[0]?.status === T.st.saving);
    await page.click(`dialog button:text-is("${T.confirmDelete}")`);
    await new Promise((r) => setTimeout(r, 800));
    check('downloads: list: Delete skips a row that started saving while the dialog was open', (await rowsOf(page)).length === 1 && (await readRecords(t)).length === 1 && (await page.locator('#dl-status').textContent()) === '');

    await fresh();
    page = await open();
    await seed(page, Array.from({ length: 501 }, (_, i) => [`m${i}.bin`])).catch(async (e) => {
      throw new Error(`seed: ${e.message}; rows ${(await rowsOf(page)).length}`);
    });
    await page.locator('tbody tr').first().click();
    await page.locator('tbody tr').last().click({ modifiers: ['Shift'] });
    await bar(page, 'delete').click();
    check('downloads: list: 501 selected rows read T.confirmDeleteUnfinished(501)', (await page.locator('dialog[open] p').textContent()) === T.confirmDeleteUnfinished(501));
    await page.click(`dialog button:text-is("${T.confirmDelete}")`);
    await until(async () => (await rowsOf(page)).length === 0, 40000).catch(async (e) => {
      throw new Error(`${e.message}; rows ${(await rowsOf(page)).length}, records ${(await readRecords(t)).length}, status ${await page.locator('#dl-status').textContent()}`);
    });
    check('downloads: list: deleting 501 rows works in chunks and leaves the status line empty', (await page.locator('#dl-status').textContent()) === '');
  });

  await attempt('screens', async () => {
    await fresh();
    const page = await open();
    await page.setViewportSize({ width: 1100, height: 700 });
    const states = [['movie.mkv', { state: 'running', category: 'video', size: 40_000_000, parts: [{ start: 0, end: 39_999_999, done: 12_000_000 }] }], ['setup.dmg', { state: 'queued', category: 'programs', size: 90_000_000 }], ['notes.pdf', { state: 'paused', category: 'documents', size: 2_000_000, parts: [{ start: 0, end: 1_999_999, done: 500_000 }] }], ['data.zip', { state: 'failed', category: 'archives', error: ERRORS.changed }], ['song.mp3', { state: 'done', category: 'music', size: 5_000_000, savedId: null }]];
    await seed(page, states);
    await until(async () => (await rowsOf(page)).length === 5);
    const text = (await page.locator('body').innerText()).toLowerCase();
    check('downloads: list: the page promises no speed-up', !/faster|accelerat|boost|turbo|speed up/.test(text));
    const narrow = await (async () => {
      await page.setViewportSize({ width: 360, height: 700 });
      return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    })();
    check('downloads: list: the page does not scroll sideways at 360 px', narrow);
    await page.setViewportSize({ width: 1100, height: 700 });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: `${t.shots}/dl-list-${scheme}.png` });
    }
  });

  check('downloads: list: no page errors', t.errors.length === errorsBefore, json(t.errors.slice(errorsBefore)));
  await fresh();
}
