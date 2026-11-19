// AI search summaries on stand-in pages (duckduckgo.com and search.brave.com mapped to the local server): proves the worker's injection path, not the live engines' markup.
import { setTimeout as sleep } from 'node:timers/promises';
import { check, launch } from './harness.mjs';

const ENGINES = [
  { host: 'duckduckgo.com', file: 'ai-duckduckgo.html', ai: '[data-react-module-id="wikinlp"]' },
  { host: 'search.brave.com', file: 'ai-brave.html', ai: '#llm-snippet' },
];
const json = (v) => String(JSON.stringify(v)).slice(0, 400);

export async function run({ servers }) {
  const { ctx, sw } = await launch({ extraHosts: ENGINES.map((e) => e.host) });
  try {
    await sleep(1000); // onInstalled stores the default settings
    const setAi = async (on) => {
      await sw.evaluate(async (v) => {
        const { settings } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, blocking: { ...settings.blocking, lists: { ...settings.blocking.lists, ai: v } } } });
      }, on);
      await sleep(300);
    };
    // The hide rule is inserted as the page starts loading: wait up to 5 s for it when the block should be hidden, and a second to be sure when it should not.
    const displays = async (engine, wantHidden) => {
      const page = await ctx.newPage();
      try {
        await page.goto(`https://${engine.host}:${servers.httpsPort}/${engine.file}`, { waitUntil: 'load' });
        const read = () => page.evaluate((ai) => [getComputedStyle(document.querySelector(ai)).display, getComputedStyle(document.querySelector('#normal-result')).display], engine.ai);
        const end = Date.now() + (wantHidden ? 5000 : 1000);
        let seen = await read();
        while ((wantHidden ? seen[0] !== 'none' : true) && Date.now() < end) {
          await sleep(100);
          seen = await read();
        }
        return seen;
      } finally {
        await page.close();
      }
    };
    for (const engine of ENGINES) {
      const off = await displays(engine, false);
      await setAi(true);
      const on = await displays(engine, true);
      await setAi(false);
      const offAgain = await displays(engine, false);
      check(
        `${engine.host}: the AI block is shown with "AI search summaries" off, hidden with it on and shown again after it goes off, and the normal result always shows`,
        off[0] !== 'none' && on[0] === 'none' && offAgain[0] !== 'none' && [off, on, offAgain].every((d) => d[1] !== 'none'),
        json({ off, on, offAgain }),
      );
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}
