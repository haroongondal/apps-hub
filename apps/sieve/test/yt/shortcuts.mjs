// Task 2.15: keyboard shortcuts. Chrome has no API to bind a key, so a real key press is on the owner checklist.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { until } from './helpers.mjs';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));

export async function local(t) {
  const { check } = t;
  const manifest = JSON.parse(readFileSync(`${DIST}manifest.json`, 'utf8'));
  const commands = Object.entries(manifest.commands ?? {});
  check('shortcuts: dist/manifest.json has 30 commands, none with suggested_key', commands.length === 30 && commands.every(([, c]) => !('suggested_key' in c) && typeof c.description === 'string'), String(commands.length));
  check('shortcuts: yt-loop, yt-quality-hd1080 and open-settings have their descriptions', manifest.commands['yt-loop']?.description === 'YouTube: loop on or off' && manifest.commands['yt-quality-hd1080']?.description === 'YouTube: quality 1080p' && manifest.commands['open-settings']?.description === 'Open Sieve settings');
  check('shortcuts: the worker listens for commands', readFileSync(`${DIST}background.js`, 'utf8').includes('commands.onCommand.addListener'));

  const all = await t.sw.evaluate(() => chrome.commands.getAll());
  // Chrome adds `_execute_action` (the toolbar button) to the manifest's 30, with no key either.
  const ours = all.filter((c) => !c.name.startsWith('_'));
  check('shortcuts: chrome.commands.getAll() in the worker returns the 30 commands (plus Chrome\'s own _execute_action), none with a key', ours.length === 30 && all.length === 31 && all.every((c) => c.shortcut === ''), `${all.length} ${all.filter((c) => c.shortcut !== '').map((c) => c.name)}`);

  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  try {
    await page.goto(`chrome-extension://${t.id}/options.html#shortcuts`);
    await page.getByRole('heading', { name: 'Shortcuts', level: 2 }).waitFor();
    const rows = page.locator('#shortcuts li');
    await until(async () => (await rows.count()) === 30);
    const texts = await rows.allInnerTexts();
    check('shortcuts: the settings page lists 30 rows, each showing "Not set"', texts.length === 30 && texts.every((x) => x.split('\n').pop().trim() === 'Not set'), `${texts.length} ${texts[0]}`);
    check('shortcuts: a row shows the command description', texts.some((x) => x.startsWith('YouTube: loop on or off')) && texts.some((x) => x.startsWith('Open Sieve settings')));
    check('shortcuts: the section says Sieve sets no keys', await page.getByText("Chrome lets you set keys for these actions. Sieve sets none, so they never clash with YouTube's keys or a site's.", { exact: true }).isVisible());

    // The worker can't see a chrome:// address (no tabs permission), so the new tab is read through Playwright.
    const [opened] = await Promise.all([t.ctx.waitForEvent('page'), page.getByRole('button', { name: 'Set shortcuts in Chrome' }).click()]);
    const at = await until(() => (opened.url().startsWith('chrome://') ? opened.url() : ''));
    check('shortcuts: "Set shortcuts in Chrome" opens a tab at chrome://extensions/shortcuts', at === 'chrome://extensions/shortcuts', opened.url());
    await opened.close().catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
}
