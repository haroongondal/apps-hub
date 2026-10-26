// Smoke test for the mobile shell (packages/pdf-editor-engine/mobile.html) in Chrome with
// a device viewport and a fake ReactNativeWebView bridge. Loads the page with
// plain classic scripts (same as Expo Go would after build.mjs inlining).
// Skips when the system Chrome binary is missing, like e2e.mjs does.
import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log('mobile smoke skipped: no Chrome at', CHROME);
  process.exit(0);
}

const dir = new URL('.', import.meta.url).pathname;
const app = new URL('../../../packages/pdf-editor-engine/mobile.html', import.meta.url).href;

// a two-page PDF so merge/delete flows have something to work with
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
doc.addPage([595, 842]).drawText('MobileDoc', { x: 72, y: 760, size: 24, font });
doc.addPage([595, 842]).drawText('SecondPage', { x: 72, y: 700, size: 18, font });
const b64 = Buffer.from(await doc.save()).toString('base64');

// 1×1 transparent PNG for the image command round-trip
const pngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });

// fake the native bridge before any page script runs
await page.addInitScript(() => {
  window.__bridge = { inbox: [] };
  window.ReactNativeWebView = { postMessage: m => window.__bridge.inbox.push(m) };
  window.__bridge.wait = async (type, match, ms = 5000) => {
    // full-inbox scan (messages post during load, before the test subscribes);
    // pass match() to skip earlier same-type messages
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = window.__bridge.inbox.map(JSON.parse).find(m => m.type === type && (!match || match(m)));
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('no "' + type + '" message seen');
  };
});

await page.goto(app);
assert.equal((await page.evaluate(() => window.__bridge.wait('ready'))).type, 'ready');
await page.evaluate(base64 => window.__editorCommand('open', { name: 'mob.pdf', base64, append: false }), b64);
const loaded = await page.evaluate(() => window.__bridge.wait('documentLoaded', m => m.name === 'mob.pdf'));
assert.equal(loaded.ok, true);
assert.equal(loaded.pages, 2);
assert.equal(loaded.name, 'mob.pdf');

// image round-trip: page posts pickImage, native answers the image command
const layer = page.locator('.layer').first();
const bb = await layer.boundingBox();
await page.click('button[data-tool="image"]');
await page.mouse.click(bb.x + 40, bb.y + 40);
const pick = await page.evaluate(() => window.__bridge.wait('pickImage'));
// The tap is 40 css px into a fit-scaled page, so page-space coords are the same
// FRACTION of the page: vp·40/bb — local() maps scale-invariantly (595·40/382.9).
assert.ok(
  Math.abs(pick.x - 595 * 40 / bb.width) < 0.5 && Math.abs(pick.y - 842 * 40 / bb.height) < 0.5,
  `coordinates survive the fit-scale transform: ${JSON.stringify(pick)}`,
);
assert.equal(pick.pageIndex, 0);
await page.evaluate(cmd => window.__editorCommand('image', { ok: true, base64: cmd.base64, pageIndex: cmd.pageIndex, x: cmd.x, y: cmd.y }), { base64: pngB64, pageIndex: pick.pageIndex, x: pick.x, y: pick.y });
await page.locator('.annot.image').waitFor();

// text tool via touch, then save through the bridge
await page.click('button[data-tool="text"]');
await page.mouse.click(bb.x + 100, bb.y + 300);
await page.keyboard.type('Bridged text');
await page.locator('.annot.text').first().press('Enter');
await page.locator('button[data-tool="select"]').click();

// merge a second copy, exercise the confirm sheet from the page bar
await page.evaluate(b => window.__editorCommand('open', { name: 'more.pdf', base64: b, append: true }), b64);
await page.evaluate(() => window.__bridge.wait('documentLoaded', m => m.name === 'mob (+1 merged)'));
assert.equal(await page.evaluate(() => document.querySelectorAll('.slot').length), 4);
await page.locator('.slot').nth(3).locator('button[title="Delete page"]').click();
assert.equal(await page.evaluate(() => document.querySelector('#sheetWrap').hidden), false, 'confirm sheet replaces window.confirm');
await page.click('#sheetNo');
await page.locator('#sheetWrap').waitFor({ state: 'hidden' });
await page.locator('.slot').nth(3).locator('button[title="Delete page"]').click();
await page.click('#sheetOk');
assert.equal(await page.evaluate(() => document.querySelectorAll('.slot').length), 3);

const [saved] = await Promise.all([
  page.evaluate(() => window.__bridge.wait('save')),
  page.click('#save'),
]);
assert.equal(saved.type, 'save');
assert.equal(saved.name, 'mob-edited.pdf');
const out = Buffer.from(saved.base64, 'base64');
const pj = await pdfjs.getDocument({ data: new Uint8Array(out) }).promise;
const t1 = await (await pj.getPage(1)).getTextContent();
assert.match(t1.items.map(i => i.str).join(' '), /Bridged text/);
const t2 = await (await pj.getPage(2)).getTextContent();
assert.match(t2.items.map(i => i.str).join(' '), /SecondPage/);

// toast command path (native save feedback)
await page.evaluate(() => window.__editorCommand('toast', { message: 'Shared mob-edited.pdf' }));
assert.equal(await page.locator('#toast').textContent(), 'Shared mob-edited.pdf');
assert.equal(await page.evaluate(() => document.querySelector('#toast').classList.contains('show')), true);

// Open button posts through the bridge for the native document picker
await page.click('#docopen');
assert.deepEqual(await page.evaluate(() => window.__bridge.wait('pickPdf')), { type: 'pickPdf', append: false });

await browser.close();
assert.deepEqual(errors, [], 'no JS dialogs or errors (WKWebView implements none of them)');
console.log('mobile bridge ok —', out.length, 'bytes saved');
