import { validateDownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { extPage, localGet, readRecords, resetDl, sendMsg, setDownloads, until } from './_helpers.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(t) {
  if (!t.fx) return t.check('downloads: list dialogs need the fixture server', false);
  const { check, fx } = t;
  const pages = [];
  const open = async () => {
    const page = await extPage(t, 'downloads.html');
    pages.push(page);
    return page;
  };
  const fresh = async (patch = {}) => {
    for (const p of pages.splice(0)) await p.close();
    fx.reset();
    await resetDl(t);
    if (Object.keys(patch).length) await setDownloads(t, patch);
  };
  const stored = async () => validateDownloadSettings((await localGet(t, 'downloads')).downloads);
  const attempt = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(`downloads: dialogs: ${name}`, false, String(e?.message ?? e).slice(0, 400));
    }
  };
  const commit = async (loc, value) => {
    await loc.fill(String(value));
    await loc.blur();
  };
  const errorsBefore = t.errors.length;
  const speedBtn = (page) => page.locator('[role=toolbar] button[data-id=speed]');
  const limit = (page) => page.locator('#dl-limit-dialog');
  const sched = (page) => page.locator('#dl-scheduler-dialog');
  const box = (page, id) => sched(page).locator(`fieldset[data-queue=${id}]`);

  await attempt('speed limit', async () => {
    await fresh();
    const page = await open();
    await speedBtn(page).click();
    await limit(page).waitFor();
    const sw = limit(page).getByRole('switch', { name: T.limitOn });
    const num = limit(page).getByLabel(T.limitValue);
    check('downloads: dialogs: the limit dialog has the switch, the number input and the note', (await sw.count()) === 1 && (await num.getAttribute('min')) === '10' && (await num.getAttribute('max')) === '1000000' && (await limit(page).innerText()).includes(T.limitNote));
    await sw.check();
    await until(async () => (await stored()).speedLimit.on);
    check('downloads: dialogs: the switch stores speedLimit.on', true);
    check('downloads: dialogs: the toolbar button is pressed while the limit is on', (await speedBtn(page).getAttribute('aria-pressed')) === 'true');
    await commit(num, 5);
    await until(async () => (await stored()).speedLimit.kbPerSecond === 10);
    check('downloads: dialogs: typing 5 stores 10 and the input shows 10', (await num.inputValue()) === '10', await num.inputValue());
    await commit(num, 2000000);
    await until(async () => (await stored()).speedLimit.kbPerSecond === 1_000_000);
    check('downloads: dialogs: 2000000 stores 1,000,000', (await num.inputValue()) === '1000000', await num.inputValue());
    await setDownloads(t, { speedLimit: { on: false, kbPerSecond: 1000 } });
    await until(async () => !(await sw.isChecked()));
    check('downloads: dialogs: a change from another page updates the open switch', (await sw.isChecked()) === false && (await speedBtn(page).getAttribute('aria-pressed')) === 'false');
    await page.keyboard.press('Escape');
    await limit(page).waitFor({ state: 'detached' });
    await speedBtn(page).click();
    await limit(page).getByRole('button', { name: T.close }).click();
    await limit(page).waitFor({ state: 'detached' });
    check('downloads: dialogs: Esc and the close button close it', true);

    await setDownloads(t, { speedLimit: { on: true, kbPerSecond: 1000 } });
    await page.locator('[data-id=add]').click();
    await page.fill('#dl-add-text', `${fx.base}/file/40000000/limited.bin?rate=8000000`);
    await page.click(`dialog button:text-is("${T.addSubmit}")`);
    const bar = () => page.locator('tbody tr progress').first().evaluate((p) => p.value);
    await until(async () => (await bar()) > 0);
    const a = await bar();
    await sleep(3000);
    const b = await bar();
    check('downloads: dialogs: a 1000 KB/s limit keeps a download under 1.5 MB/s over 3 s', ((b - a) / 100) * 40 < 4.5 && b > a, json({ a, b }));
  });

  await attempt('scheduler', async () => {
    await fresh();
    const page = await open();
    await page.locator('[data-id=scheduler]').click();
    await sched(page).waitFor();
    const main = box(page, 'main');
    check('downloads: dialogs: the scheduler lists the default queue with its settings', (await main.getByLabel(T.setQueueName).inputValue()) === 'Main queue' && (await main.getByLabel(T.scheduleParallel).inputValue()) === '3' && !(await main.getByRole('switch', { name: T.scheduleUse }).isChecked()));
    check('downloads: dialogs: the first queue has no remove button', (await main.getByRole('button').count()) === 0);
    await main.getByRole('switch', { name: T.scheduleUse }).check();
    await until(async () => (await stored()).queues[0].schedule.on);
    await main.getByLabel('Sun', { exact: true }).uncheck();
    await until(async () => !(await stored()).queues[0].schedule.days.includes(0));
    check('downloads: dialogs: the schedule switch and the day boxes store', true);
    await commit(main.getByLabel(T.scheduleStart), '22:00');
    await commit(main.getByLabel(T.scheduleStop), '06:00');
    await until(async () => (await stored()).queues[0].schedule.stop === '06:00');
    const sc = (await stored()).queues[0].schedule;
    check('downloads: dialogs: start 22:00 and stop 06:00 are stored', sc.start === '22:00' && sc.stop === '06:00', json(sc));
    await main.getByLabel(T.scheduleNoStop).check();
    await until(async () => (await stored()).queues[0].schedule.stop === null);
    check('downloads: dialogs: no stop stores null and disables the stop input', await main.getByLabel(T.scheduleStop).isDisabled());
    await main.getByLabel(T.scheduleNoStop).uncheck();
    await until(async () => (await stored()).queues[0].schedule.stop !== null);
    await commit(main.getByLabel(T.scheduleParallel), 5);
    await until(async () => (await stored()).queues[0].maxParallel === 5);
    check('downloads: dialogs: the parallel count is stored', true);

    await sched(page).getByRole('button', { name: T.setAddQueue }).click();
    await until(async () => (await stored()).queues.length === 2);
    const q2 = (await stored()).queues[1];
    check('downloads: dialogs: Add a queue adds Queue 2 with id q2', q2.id === 'q2' && q2.name === 'Queue 2', json(q2));
    await commit(box(page, 'q2').getByLabel(T.setQueueName), 'Night');
    await until(async () => (await stored()).queues[1].name === 'Night');
    check('downloads: dialogs: renaming stores Night', (await box(page, 'q2').locator('legend').textContent()) === 'Night');
    await sched(page).getByRole('button', { name: T.setRemoveQueue('Night') }).click();
    await until(async () => (await stored()).queues.length === 1);
    await sched(page).getByRole('button', { name: T.setAddQueue }).click();
    await until(async () => (await stored()).queues.length === 2);
    check('downloads: dialogs: after a removal the next queue is q2 again', (await stored()).queues[1].id === 'q2');
    const longName = 'x'.repeat(41);
    await commit(box(page, 'q2').getByLabel(T.setQueueName), longName);
    await until(async () => (await box(page, 'q2').getByLabel(T.setQueueName).inputValue()) === 'Queue 2');
    check('downloads: dialogs: a 41-character name is stored repaired and the input shows it', (await stored()).queues[1].name === 'Queue 2');
    for (let i = 0; i < 6; i++) await sched(page).getByRole('button', { name: T.setAddQueue }).click();
    await until(async () => (await stored()).queues.length === 8);
    check('downloads: dialogs: at 8 queues Add a queue is disabled', await sched(page).getByRole('button', { name: T.setAddQueue }).isDisabled());
    check('downloads: dialogs: the ids stay unique', new Set((await stored()).queues.map((q) => q.id)).size === 8);
  });

  await attempt('two writers', async () => {
    await fresh();
    const a = await open();
    const b = await open();
    for (const p of [a, b]) {
      await p.locator('[data-id=scheduler]').click();
      await sched(p).waitFor();
    }
    // Direct change events: Playwright's fill and blur need page focus, which two background pages cannot both have.
    const change = (loc, value) => loc.evaluate((el, v) => ((el.value = v), el.dispatchEvent(new Event('change', { bubbles: true }))), String(value));
    await Promise.all([change(box(a, 'main').getByLabel(T.scheduleParallel), 7), change(box(b, 'main').getByLabel(T.setQueueName), 'Both')]);
    await sleep(500);
    const q = (await stored()).queues[0];
    check('downloads: dialogs: two pages changing two fields keep both', q.maxParallel === 7 && q.name === 'Both', json(q));
    await until(async () => (await box(a, 'main').getByLabel(T.setQueueName).inputValue()) === 'Both');
    check('downloads: dialogs: the other page shows the change in place', true);
  });

  await attempt('records and queues', async () => {
    const closedDay = (new Date().getDay() + 1) % 7;
    await fresh({ queues: [{ id: 'main', name: 'Main queue', maxParallel: 3, schedule: { on: false, days: [0, 1, 2, 3, 4, 5, 6], start: '01:00', stop: '07:00' } }, { id: 'q2', name: 'Later', maxParallel: 3, schedule: { on: true, days: [closedDay], start: '00:00', stop: '23:59' } }] });
    const page = await open();
    const reply = await sendMsg(t, { type: 'dl-add', items: [{ url: `${fx.base}/file/40000000/held.bin?rate=1000000`, referrer: '', queue: 'q2', source: 'manual' }] });
    await until(async () => (await readRecords(t)).length === 1);
    await sleep(1500);
    const held = (await readRecords(t))[0];
    check('downloads: dialogs: a record in a closed queue waits', reply?.ok && held.state === 'queued', json({ reply, state: held?.state }));
    await page.locator('[data-id=scheduler]').click();
    await sched(page).getByRole('button', { name: T.setRemoveQueue('Later') }).click();
    await until(async () => (await stored()).queues.length === 1);
    const after = await until(async () => (await readRecords(t)).find((r) => r.state === 'running'));
    check('downloads: dialogs: removing the queue leaves the record and the first queue runs it', after.id === held.id, json({ id: after?.id, held: held.id }));
  });

  await attempt('screens', async () => {
    await fresh();
    const page = await open();
    await page.setViewportSize({ width: 900, height: 800 });
    await page.locator('[data-id=scheduler]').click();
    await sched(page).getByRole('button', { name: T.setAddQueue }).click();
    await until(async () => (await stored()).queues.length === 2);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await sleep(300);
      await page.screenshot({ path: `${t.shots}/dl-scheduler-${scheme}.png` });
    }
    await page.setViewportSize({ width: 360, height: 700 });
    check('downloads: dialogs: the scheduler does not scroll sideways at 360 px', await sched(page).evaluate((d) => d.scrollWidth <= d.clientWidth));
  });

  check('downloads: dialogs: no page errors', t.errors.length === errorsBefore, json(t.errors.slice(errorsBefore)));
  await fresh();
}
