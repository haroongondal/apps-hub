// "Pause on this page" on a home page must not stop the registered ads CSS on the site's other pages; `/` is checked on purpose.
// Its own plain-HTTP server makes `/` an HTML page. SITE_HOST maps to 127.0.0.1 and is not in the ads list's genericExcept.
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { SITE_HOST, check } from './harness.mjs';

const json = (v) => String(JSON.stringify(v)).slice(0, 500);
const PAGE = '<!doctype html><title>Page entry</title><ins class="adsbygoogle" data-ad-client="ca-pub-1">generic ad</ins>';

export async function checkPageEntry({ ctx, sw, meta }) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://${SITE_HOST}:${server.address().port}`;
  const display = async (path) => {
    const page = await ctx.newPage();
    await page.goto(`${base}${path}`, { waitUntil: 'load' });
    const shown = await page.evaluate(() => getComputedStyle(document.querySelector('ins.adsbygoogle')).display);
    await page.close();
    return shown;
  };
  const setAllowlist = (allowlist) =>
    sw.evaluate(
      (a) =>
        navigator.locks.request('sieve-settings', async () => {
          const { settings } = await chrome.storage.local.get('settings');
          await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, allowlist: a } } });
        }),
      allowlist,
    );
  const adsExcluding = async (pattern, present) => {
    for (let end = Date.now() + 10_000; Date.now() < end; await sleep(100)) {
      const [ads] = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts({ ids: ['generic-ads'] }));
      if (!!ads?.excludeMatches?.includes(pattern) === present) return ads;
    }
    return null;
  };

  try {
    const { settings } = await sw.evaluate(() => chrome.storage.local.get('settings'));
    const before = settings.blocking.allowlist;
    const ready = meta.features.ads.hasGenericCss && !meta.features.ads.genericExcept.includes(SITE_HOST) && before.length === 0;
    const plain = ready && (await display('/other'));
    check(`with nothing allowlisted, the registered ads CSS hides .adsbygoogle on ${base}/other`, plain === 'none', json({ ready, plain, before }));

    const pattern = `*://${SITE_HOST}/`;
    await setAllowlist([{ kind: 'page', url: `${base}/` }]);
    const ads = await adsExcluding(pattern, true);
    const [root, other, query] = [await display('/'), await display('/other'), await display('/?x=1')];
    check(
      `a paused home page (${base}/) is excluded from the ads CSS as that page only: it shows .adsbygoogle, while /other and /?x=1 still hide it`,
      ads !== null && root !== 'none' && other === 'none' && query === 'none',
      json({ excludeMatches: ads?.excludeMatches?.filter((p) => p.includes(SITE_HOST)), root, other, query }),
    );
    await setAllowlist(before);
    await adsExcluding(pattern, false);
  } finally {
    server.close();
  }
}
