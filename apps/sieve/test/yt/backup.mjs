// Task 2.18: settings backup and import, on the settings page. No YouTube page is needed.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { TRACKER_HOST } from '../harness.mjs';
import { setYouTube, until } from './helpers.mjs';

const json = (v) => JSON.stringify(v);
const allStorage = (t) => t.sw.evaluate(() => chrome.storage.local.get(null));

export async function local(t) {
  const { check } = t;
  const OPTIONS = `chrome-extension://${t.id}/options.html`;
  const ADS = `https://localhost:${t.servers.httpsPort}/ads.html`;
  const FILTER = `||${TRACKER_HOST}^`;
  const trackerThrough = async () => {
    t.servers.hits.length = 0;
    const page = await t.ctx.newPage();
    await page.goto(ADS, { waitUntil: 'load' });
    await page.close();
    return t.servers.hits.includes('/sieve-tracker.js');
  };
  const open = async () => {
    const page = await t.ctx.newPage();
    page.on('pageerror', (e) => t.errors.push(e.message));
    await page.goto(OPTIONS);
    await page.getByRole('heading', { name: 'Backup and import' }).waitFor();
    return page;
  };
  let page;
  try {
    // Saving: an allowlist site, My filters (with the Trackers list off, so only the filter blocks the tracker) and a YouTube option.
    page = await open();
    await page.getByRole('textbox', { name: 'Site or page address' }).fill('example.com');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('switch', { name: 'Trackers', exact: true }).uncheck();
    await page.getByRole('textbox', { name: 'My filters' }).fill(FILTER);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved 1 filter.').waitFor();
    await setYouTube(t, { speed: { default: 1.5 }, on: false });
    check('backup: with the filter and the Trackers list off, the tracker request is blocked', !(await trackerThrough()));

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a backup' }).click()]);
    const text = readFileSync(await download.path(), 'utf8');
    const saved = JSON.parse(text);
    const stamp = new Date();
    check('backup: the file is named sieve-settings with today\'s local date', /^sieve-settings-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()) && download.suggestedFilename().includes(`${stamp.getFullYear()}-`), download.suggestedFilename());
    check(
      'backup: the file holds the allowlist site, My filters, youtube.speed.default 1.5 and youtube.on false',
      saved.app === 'sieve' && saved.version === 1 && saved.settings.blocking.allowlist.some((e) => e.host === 'example.com') && saved.settings.blocking.myFilters === FILTER && saved.youtube.speed.default === 1.5 && saved.youtube.on === false && saved.settings.blocking.lists.trackers === false,
      text.slice(0, 300),
    );

    // Importing: back to the defaults first, then the saved file.
    await t.sw.evaluate(async () => {
      await chrome.storage.local.clear();
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map((r) => r.id) });
    });
    check('backup: after clearing to the defaults, no My filters rule is left', await until(async () => (await t.sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length === 0), '');
    await page.reload();
    await page.getByRole('heading', { name: 'Backup and import' }).waitFor();
    const input = page.locator('input[type=file]');
    const file = { name: 'sieve.json', mimeType: 'application/json', buffer: Buffer.from(text) };
    await input.setInputFiles(file);
    const warning = page.getByText('Importing replaces all your Sieve settings, filters and allowlist.');
    await warning.waitFor();
    const untouched = json(await allStorage(t));
    await page.getByRole('button', { name: 'Cancel' }).click();
    check('backup: Cancel hides the warning and writes nothing', !(await warning.isVisible()) && json(await allStorage(t)) === untouched, `${await warning.isVisible()} ${untouched.slice(0,200)} || ${json(await allStorage(t)).slice(0,200)}`);

    await input.setInputFiles(file);
    await page.getByRole('button', { name: 'Replace my settings' }).click();
    await page.getByText('Imported your settings.').waitFor();
    const after = await allStorage(t);
    check('backup: settings and youtube equal the backup\'s', isDeepStrictEqual(after.settings, saved.settings) && isDeepStrictEqual(after.youtube, saved.youtube), json(after).slice(0, 300));
    const dynamic = await until(async () => {
      const rules = await t.sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
      return rules.some((r) => r.condition.urlFilter?.includes(TRACKER_HOST)) ? rules : null;
    });
    check('backup: My filters compiled again (myRules is not empty and the dynamic rules include the tracker rule)', (after.myRules?.length ?? 0) > 0 && !!dynamic, json(dynamic));
    check('backup: the tracker request is blocked again', !(await trackerThrough()));
    check('backup: the page shows no error', (await page.locator('#backup [role=alert]').innerText()) === '');
    await page.close();

    // A bad file changes nothing.
    page = await open();
    const before = json(await allStorage(t));
    const alert = page.getByRole('alert').filter({ hasText: /./ });
    await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await alert.waitFor();
    check('backup: a text file says it is not valid JSON, and storage is unchanged', (await alert.innerText()) === "This file isn't a Sieve backup: it isn't valid JSON." && json(await allStorage(t)) === before && (await page.getByRole('button', { name: 'Replace my settings' }).count()) === 0);
    await page.locator('input[type=file]').setInputFiles({ name: 'new.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"sieve","version":2}') });
    await page.getByText('This backup comes from a newer Sieve. Update Sieve, then import it again.').waitFor();
    check('backup: a newer version says to update Sieve, and storage is unchanged', json(await allStorage(t)) === before);
    await page.close();
  } finally {
    await page?.close().catch(() => {});
    await t.sw.evaluate(async () => {
      await chrome.storage.local.clear();
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map((r) => r.id) });
    }).catch(() => {});
  }
}
