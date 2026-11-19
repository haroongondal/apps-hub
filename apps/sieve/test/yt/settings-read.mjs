// Task 2.16 close minors: the YouTube section becomes usable even when the first read of the stored settings fails, or showing them throws.
import { setYouTube } from './helpers.mjs';

const reset = (t) => t.sw.evaluate(() => chrome.storage.local.remove('youtube'));

// mode 'reject': the first youtube read rejects. mode 'show': it resolves, but the first textarea value set after it throws.
async function open(t, mode) {
  const page = await t.ctx.newPage();
  await page.addInitScript((m) => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    let reads = 0;
    chrome.storage.local.get = (...a) => {
      if (String(a[0]) !== 'youtube' || reads++ > 0) return get(...a);
      if (m === 'reject') return Promise.reject(new Error('test: read refused'));
      return get(...a).then((r) => ((window.__breakShow = true), r));
    };
    const value = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
      ...value,
      set(v) {
        if (window.__breakShow) {
          window.__breakShow = false;
          throw new Error('test: show failed');
        }
        value.set.call(this, v);
      },
    });
  }, mode);
  await page.goto(`chrome-extension://${t.id}/options.html#youtube`);
  await page.locator('#youtube').waitFor();
  return page;
}

const usable = (page) => page.waitForFunction(() => !document.querySelector('#youtube').inert, null, { timeout: 3000 }).then(() => true, () => false);
const toolsOn = (page) => page.locator('#youtube').getByRole('switch', { name: 'YouTube tools', exact: true }).isChecked();

export async function local(t) {
  const { check } = t;
  let page;
  try {
    await reset(t);
    page = await open(t, 'reject');
    check('settings read: when reading the stored YouTube settings fails, the section still becomes usable, showing the defaults', (await usable(page)) && (await toolsOn(page)));
    await page.close();

    await setYouTube(t, { experiments: { overrides: 'sieve_test_flag=false' } });
    page = await open(t, 'show');
    check('settings read: when showing the stored settings throws, the section still becomes usable', (await usable(page)) && (await page.evaluate(() => window.__breakShow)) === false);
  } finally {
    await page?.close().catch(() => {});
    await reset(t);
  }
}
