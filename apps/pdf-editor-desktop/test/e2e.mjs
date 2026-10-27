import { chromium } from 'playwright-core';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const dir = new URL('.', import.meta.url).pathname;
const app = new URL('../../../packages/pdf-editor-engine/desktop.html', import.meta.url).href;
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const label of ['PageOne', 'PageTwo']) doc.addPage([612, 792]).drawText(label, { x: 72, y: 700, size: 24, font });
fs.writeFileSync(dir + 'in.pdf', await doc.save());

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
await page.goto(app);
await page.setInputFiles('#open', dir + 'in.pdf');
await page.waitForSelector('.slot >> nth=1');

const layer = page.locator('.layer').first();
const bb = await layer.boundingBox();
await page.click('button[data-tool="text"]');
await page.mouse.click(bb.x + 100, bb.y + 300);
await page.keyboard.type('Added text');
await page.click('button[data-tool="highlight"]');
await page.mouse.move(bb.x + 100, bb.y + 400); await page.mouse.down(); await page.mouse.move(bb.x + 300, bb.y + 450, { steps: 5 }); await page.mouse.up();
await page.click('button[data-tool="draw"]');
await page.mouse.move(bb.x + 100, bb.y + 500); await page.mouse.down(); await page.mouse.move(bb.x + 300, bb.y + 600, { steps: 5 }); await page.mouse.up();
// move page 2 up, then rotate it (it is now page 1)
await page.locator('.slot').nth(1).locator('button[title="Move up"]').click();
await page.locator('.slot').first().locator('button[title="Rotate right"]').click();


const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
await dl.saveAs(dir + 'out.pdf');
await browser.close();
assert.deepEqual(errors, []);

const out = await PDFDocument.load(fs.readFileSync(dir + 'out.pdf'));
assert.equal(out.getPageCount(), 2);
assert.equal(out.getPage(0).getRotation().angle, 90);
assert.equal(out.getPage(1).getRotation().angle, 0);
const pj = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(dir + 'out.pdf')) }).promise;
const text = async n => (await (await pj.getPage(n)).getTextContent()).items.map(i => i.str).join(' ');
assert.match(await text(1), /PageTwo/);
const t2 = await (await pj.getPage(2)).getTextContent();
assert.match(t2.items.map(i => i.str).join(' '), /PageOne.*Added text/);
const added = t2.items.find(i => i.str === 'Added text');
// clicked 300 css px below top at scale 1.5 => ~200pt from top => y ~ 792-200
console.log('added text at', added.transform[4].toFixed(1), added.transform[5].toFixed(1));
assert.ok(Math.abs(added.transform[4] - 100 / 1.5) < 3 && Math.abs(added.transform[5] - (792 - 300 / 1.5)) < 12);
const ops = await (await pj.getPage(2)).getOperatorList();
console.log('ops on edited page:', ops.fnArray.length, 'OK');

// Edit text: a Chrome-printed PDF uses subset CID fonts, like most real-world PDFs
{
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const maker = await browser.newPage();
  // a tinted page with navy text: edited boxes must match it, not show white on black
  await maker.setContent('<body style="background:#fde68a;color:#1e3a8a"><p style="font:24px Georgia">Hello World from Chrome</p><p style="font:16px Arial">Second line here</p><p style="font:16px Arial">Untouched line</p></body>');
  fs.writeFileSync(dir + 'chrome.pdf', await maker.pdf({ printBackground: true }));
  const before = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(dir + 'chrome.pdf')) }).promise;
  const origItems = (await (await before.getPage(1)).getTextContent()).items;

  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(app);
  await page.setInputFiles('#open', dir + 'chrome.pdf');
  await page.waitForSelector('.slot');
  await page.click('button[data-tool="edittext"]');
  await page.waitForSelector('.tbox >> nth=2');
  const edit = async (from, to) => {
    await page.locator('.tbox', { hasText: from }).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(to);
    await page.keyboard.press('Enter');
  };
  await edit('Hello World from Chrome', 'Hello Chrome'); // every glyph is in the original subset font
  await edit('Second line here', 'Brand new Xylo text'); // needs glyphs the subset lacks -> standard font
  // the pointer is still over this box; hover styling must not let the old canvas text show through
  const style = await page.locator('.tbox.edited', { hasText: 'Brand new Xylo text' }).evaluate(e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
  assert.equal(style[0], 'rgb(253, 230, 138)');
  const near = (css, [r, g, b]) => { const [x, y, z] = css.match(/\d+/g).map(Number); return Math.abs(x - r) + Math.abs(y - g) + Math.abs(z - b) < 60; };
  assert.ok(near(style[1], [0x1e, 0x3a, 0x8a]), `edited text colour ${style[1]} should be the page's navy`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
  await dl.saveAs(dir + 'chrome-out.pdf');
  await browser.close();
  assert.deepEqual(errors, []);

  const after = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(dir + 'chrome-out.pdf')) }).promise;
  const items = (await (await after.getPage(1)).getTextContent()).items;
  const all = items.map(i => i.str).join('|');
  console.log('edited page text:', all);
  assert.match(all, /Hello\s*Chrome/);
  assert.match(all, /Brand new Xylo text/);
  assert.match(all, /Untouched line/);
  assert.doesNotMatch(all, /World|Second/);
  const pos = (list, re) => list.find(i => re.test(i.str)).transform.slice(4, 6).map(v => +v.toFixed(1));
  assert.deepEqual(pos(items, /^Hello/), pos(origItems, /^Hello/));
  assert.deepEqual(pos(items, /^Brand/), pos(origItems, /^Second/));
  assert.deepEqual(pos(items, /^Untouched/), pos(origItems, /^Untouched/));
  console.log('edit text OK');
}
