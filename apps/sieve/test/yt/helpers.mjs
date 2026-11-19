import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { NAV } from '../../src/yt/selectors.ts';

export const FIXTURE_IDS = ['sieveTest01', 'sieveTest02', 'sieveTest03', 'sieveTest04', 'sieveTest05'];
const CORE = new URL('../../../../packages/sieve-core/src/', import.meta.url).href;

export async function ytModules(only = null) {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const names = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'helpers.mjs').map((f) => f.slice(0, -4)).sort();
  const wanted = names.filter((n) => n === 'fixture' || !only || only.includes(n));
  const unknown = (only ?? []).filter((n) => !names.includes(n));
  const loaded = await Promise.all(wanted.map(async (name) => {
    try {
      return [name, await import(`./${name}.mjs`)];
    } catch (e) {
      return [name, { importError: String(e?.message ?? e).split('\n')[0] }];
    }
  }));
  return [...loaded, ...unknown.map((name) => [name, { importError: 'no such module in test/yt/' }])];
}

export function ytUrl(t, path, fixture = 'watch') {
  const url = new URL(path, t.base);
  url.searchParams.set('fixture', fixture);
  return url.href;
}

export async function openYt(t, path, fixture) {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  await page.goto(ytUrl(t, path, fixture), { waitUntil: 'load' });
  return page;
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (a, b) => (isPlain(a) && isPlain(b) ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, k in b ? deepMerge(a[k], b[k]) : a[k]])) : b);

export async function setYouTube(t, patch) {
  const { mergeYouTube, validateYouTube, YOUTUBE_KEY } = await import(`${CORE}youtube-settings.ts`);
  const stored = (await t.sw.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), YOUTUBE_KEY)) ?? null;
  const merged = mergeYouTube(validateYouTube(stored), patch);
  await t.sw.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [YOUTUBE_KEY, merged]);
  return merged;
}

export async function setSettings(t, patch) {
  const { validateSettings } = await import(`${CORE}settings.ts`);
  const stored = await t.sw.evaluate(() => chrome.storage.local.get('settings').then((r) => r.settings));
  const merged = validateSettings(deepMerge(validateSettings(stored), patch));
  await t.sw.evaluate((v) => chrome.storage.local.set({ settings: v }), merged);
  return merged;
}

export const row = (page) => page.locator('sieve-yt-row');
export const rowButton = (page, name) => row(page).getByRole('button', { name });

export async function navigate(page, id, query = {}) {
  await page.evaluate(
    ([i, q, nav]) => new Promise((resolve, reject) => {
      const target = nav.target === 'window' ? window : document;
      const timer = setTimeout(() => reject(new Error('NAV.finish did not fire')), 5000);
      target.addEventListener(nav.finish, () => { clearTimeout(timer); resolve(); }, { once: true });
      window.__navigate(i, q);
    }),
    [id, query, NAV],
  );
}

export const ytCalls = (page, name) => page.evaluate((n) => window.__ytCalls.filter((c) => !n || c.name === n), name ?? null);

export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() >= end) return v;
    await sleep(50);
  }
}

// The worker's `chrome.tabs.sendMessage` to the page's tab (every frame); a send nobody answers resolves with the error text.
export const sendToTab = (t, page, message) =>
  t.sw.evaluate(async ([url, msg]) => {
    const tab = (await chrome.tabs.query({})).find((x) => x.url === url);
    if (!tab) throw new Error(`no tab at ${url}`);
    return chrome.tabs.sendMessage(tab.id, msg).catch((e) => String(e?.message ?? e));
  }, [page.url(), message]);

export const storedYouTube = (t) => t.sw.evaluate(() => chrome.storage.local.get('youtube').then((r) => r.youtube ?? null));

export const latestDownload = (t) => t.sw.evaluate(() => chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 }).then((r) => r[0]));
