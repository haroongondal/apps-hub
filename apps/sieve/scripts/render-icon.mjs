// Needs playwright-core and a Chromium: set PLAYWRIGHT_CORE and CHROMIUM_PATH if yours live elsewhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? join(homedir(), 'Documents/browser-automation/node_modules/playwright-core/index.mjs'));
const CHROMIUM = process.env.CHROMIUM_PATH ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const svg = readFileSync(join(assets, 'icon.svg'), 'utf8');

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 }); // fresh in-memory context, never a user profile
  for (const size of [16, 32, 48, 128]) {
    const page = await context.newPage();
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    writeFileSync(join(assets, `icon-${size}.png`), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
    await page.close();
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
