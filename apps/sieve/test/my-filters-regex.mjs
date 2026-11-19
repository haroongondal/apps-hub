// A My filters save with a regex Chrome refuses (RE2 has no lookahead), in real Chrome: the line is listed in plain words, the other lines are saved, the earlier rule stays on.
import { setTimeout as sleep } from 'node:timers/promises';
import { TRACKER_HOST, check, launch } from './harness.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const TRACKER_FILTER = `||${TRACKER_HOST}^$third-party`;
const OTHER_FILTER = '||refused-regex-other.example^';

export async function run({ servers }) {
  const { ctx, sw, id } = await launch();
  try {
    await sleep(1000); // onInstalled stores the default settings
    await sw.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, lists: { ...settings.blocking.lists, trackers: false } } } });
    });
    for (const end = Date.now() + 10_000; Date.now() < end && (await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).includes('trackers'); ) await sleep(100);

    const opt = await ctx.newPage();
    await opt.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
    const box = opt.getByRole('textbox', { name: 'My filters' });
    const save = async (text) => {
      await box.evaluate((el, t) => {
        el.value = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
      await opt.locator('#my-filters').getByRole('button', { name: 'Save', exact: true }).click();
      await opt.waitForFunction(() => !document.querySelector('.result').textContent.includes('Saving'), null, { timeout: 60_000 });
      return opt.locator('.result').innerText();
    };
    const trackerLoads = async () => {
      servers.hits.length = 0;
      const page = await ctx.newPage();
      await page.goto(`https://localhost:${servers.httpsPort}/ads.html`, { waitUntil: 'load' });
      await page.close();
      return servers.hits.includes('/sieve-tracker.js');
    };
    const stored = () => sw.evaluate(() => chrome.storage.local.get(['myRules', 'myRuleSources']));

    const first = await save(`${TRACKER_FILTER}\n`);
    const text = `${TRACKER_FILTER}\n/a(?!b)/\n${OTHER_FILTER}\n`;
    const said = await save(text);
    const listed = await opt.locator('.errors li').allInnerTexts();
    const after = await stored();
    const dynamic = await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    check(
      'a My filters save with /a(?!b)/ lists it as an error in plain words, saves the valid lines and keeps the earlier rule blocking',
      first.startsWith('Saved 1 filter.') &&
        said.startsWith('Saved 2 filters.') &&
        !said.includes('Chrome refused these filters') &&
        listed.length === 1 &&
        listed[0].startsWith("Line 2: Chrome can't run this regular expression. Take out lookarounds") &&
        same(Object.values(after.myRuleSources ?? {}).sort(), [OTHER_FILTER, TRACKER_FILTER].sort()) &&
        after.myRules?.length === 2 &&
        dynamic.length === 2 &&
        !(await trackerLoads()),
      json({ first, said, listed, after, dynamic: dynamic.length }),
    );
    const settings = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.blocking.myFilters);
    check('the refused-regex save stores the text as typed, so the owner can fix the line', settings === text, json(settings));
  } finally {
    await ctx.close().catch(() => {});
  }
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
