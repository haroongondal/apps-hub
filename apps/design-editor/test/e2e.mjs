import { _electron } from 'playwright-core';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const out = new URL('out/', import.meta.url).pathname;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'design-editor-test-'));
// hosts like VS Code set ELECTRON_RUN_AS_NODE, which makes Electron start as plain Node
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const errors = [];

async function launch() {
  const app = await _electron.launch({ args: [root], env: { ...env, DESIGN_EDITOR_DATA: data } });
  await app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = async (_, o) => ({ canceled: false, filePath: out + (o.defaultPath.endsWith('.json') ? 'My poster.json' : o.defaultPath) });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.nextOpen || out + 'My poster.json'] });
  }, out);
  const page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.waitForSelector('.tpl >> nth=3');
  await page.waitForTimeout(300);
  const menu = id => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
  const win = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { title: w.getTitle(), edited: w.isDocumentEdited() }; });
  return { app, page, menu, win };
}
const settle = page => page.waitForTimeout(300);
// waitForFunction evals a string in the page, which the app's CSP blocks
async function until(fn) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(fn)) return; await page.waitForTimeout(50); }
  throw new Error('timed out waiting for ' + fn);
}

let { app, page, menu, win } = await launch();
const count = () => page.evaluate(() => editor.canvas.getObjects().length);
const pageOf = () => page.evaluate(() => editor.page);
const thumb = i => page.click(`#pageList li:nth-child(${i + 1}) button`);
assert.deepEqual(await page.evaluate(() => [['bold', false], ['600', false], ['900', false], ['600', true], ['normal', true]]
  .map(([w, i]) => editor.pickFace('Atkinson Hyperlegible Next', w, i)).map(f => f.weight + (f.italic ? 'i' : ''))), ['700', '600', '800', '700i', '400i']);
assert.deepEqual(await page.evaluate(() => editor.pickFace('Dancing Script', 'bold', true)), { family: 'Dancing Script', src: 'vendor/fonts/DancingScript_700Bold.ttf', weight: 700, italic: false });
assert.deepEqual(await win(), { title: 'Untitled', edited: false });

await page.click('.tpl >> nth=0');
await settle(page);
assert.equal(await count(), 5);
assert.equal((await win()).edited, true);

await page.click('[data-tab="text"]');
await page.click('[data-text="heading"]');
await settle(page);
assert.equal(await page.textContent('#inspector h2'), 'Text');
await page.click('#fb');
await settle(page);
await menu('undo'); await settle(page);
await menu('undo'); await settle(page);
assert.equal(await count(), 5, 'menu undo removes the heading');
await menu('redo'); await settle(page);
assert.equal(await count(), 6, 'menu redo brings it back');

await page.evaluate(() => editor.canvas.setActiveObject(editor.canvas.getObjects()[0]));
// built-in role items ignore a scripted click(), so call what the Copy and Paste roles call
const edit = cmd => app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0].webContents[cmd](), cmd);
await edit('copy'); await settle(page);
await edit('paste'); await settle(page);
assert.equal(await count(), 7, 'copy and paste from the Edit menu');
await menu('duplicate'); await settle(page);
assert.equal(await count(), 8, 'duplicate from the Edit menu');

// white image with a red square in the middle
const png = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = c.height = 200;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 200); x.fillStyle = '#d00'; x.fillRect(60, 60, 80, 80);
  return c.toDataURL('image/png').split(',')[1];
});
await page.click('[data-tab="uploads"]');
await page.setInputFiles('#imgFile', { name: 'square.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await until(() => editor.canvas.getActiveObject()?.type === 'image');
await page.click('#rbg');
await until(() => document.querySelector('#toast').textContent === 'Background removed');
const alpha = await page.evaluate(() => {
  const img = editor.canvas.getActiveObject().getElement();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return [x.getImageData(5, 5, 1, 1).data[3], x.getImageData(100, 100, 1, 1).data[3]];
});
assert.deepEqual(alpha, [0, 255], 'corner cleared, subject kept');

const before = await page.evaluate(() => editor.canvas.getObjects()[1].getScaledWidth());
await page.click('[data-tab="resize"]');
await page.fill('#cw', '540'); await page.fill('#ch', '1920');
await page.click('#applySize');
await settle(page);
assert.deepEqual(await page.evaluate(() => editor.size), [540, 1920]);
const after = await page.evaluate(() => editor.canvas.getObjects()[1].getScaledWidth());
assert.ok(Math.abs(after - before / 2) < 1, 'magic resize halves content');

// a template on a page with content goes on a new page
await page.click('[data-tab="templates"]');
await page.click('.tpl >> nth=1'); await settle(page);
await page.click('.tpl >> nth=2'); await settle(page);
assert.deepEqual(await pageOf(), [2, 3]);
assert.equal(await count(), 5);
await page.click('[data-tab="text"]');
await page.click('[data-text="body"]'); await settle(page);
await thumb(0); await settle(page);
assert.deepEqual(await pageOf(), [0, 3]);
await menu('undo'); await settle(page);
assert.deepEqual([await pageOf(), await count()], [[2, 3], 5], 'undo goes back to the page the change was made on');
await thumb(0); await settle(page);
await menu('redo'); await settle(page);
assert.deepEqual([await pageOf(), await count()], [[2, 3], 6], 'redo too');
await page.click('#pageDup'); await settle(page);
assert.deepEqual(await pageOf(), [3, 4]);
await page.click('#pageLeft'); await settle(page);
assert.deepEqual([await pageOf(), await count()], [[2, 4], 6]);
await page.click('#pageDel'); await settle(page);
assert.deepEqual(await pageOf(), [2, 3]);
await page.focus('#pageAdd');
await page.keyboard.press('Shift+Tab');
assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Page 3 of 3', 'page thumbnails are keyboard reachable');
await thumb(0); await settle(page);

await menu('save'); await settle(page);
assert.deepEqual(await win(), { title: 'My poster', edited: false });
const savedDoc = JSON.parse(fs.readFileSync(out + 'My poster.json', 'utf8'));
assert.deepEqual([savedDoc.version, savedDoc.W, savedDoc.pages.length], [2, 540, 3]);
assert.ok(['Jost', 'Atkinson Hyperlegible Next', 'Playfair Display', 'Dancing Script'].every(f => savedDoc.fonts.includes(f)), 'file records its fonts');

async function exportAs(fmt, file) {
  await page.click('#exportBtn');
  await page.selectOption('#fmt', fmt);
  await page.click('#download');
  await until(() => document.querySelector('#toast').textContent.startsWith('Downloaded'));
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  return fs.readFileSync(out + file);
}
const outPng = await exportAs('png', 'My poster.png');
assert.deepEqual([outPng.readUInt32BE(16), outPng.readUInt32BE(20)], [1080, 3840], 'PNG at 2x design size');
const pdfBytes = await exportAs('pdf', 'My poster.pdf');
const pdf = await PDFDocument.load(pdfBytes);
assert.deepEqual(pdf.getPages().map(p => Object.values(p.getSize())), [[405, 1440], [405, 1440], [405, 1440]]);
const fontFiles = pdf.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('FontFile2')));
assert.ok(fontFiles.some(([, o]) => String(o.get(PDFName.of('FontName'))).startsWith('/Jost-Bold-')), 'a subset of the Jost font file is embedded');
const pdfText = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
const textOf = async n => (await (await pdfText.getPage(n)).getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
const headings = [['Summer sale', 'Add a heading'], ['Design is not just what it looks like. Design is how it works.'], ['Studio open night', 'You’re invited']];
for (const [i, want] of headings.entries()) {
  const got = await textOf(i + 1);
  for (const h of want) assert.ok(got.includes(h), `PDF page ${i + 1} has the text "${h}", got "${got}"`);
}
await page.click('#exportBtn');
await page.selectOption('#fmt', 'png');
await page.check('#allPages');
await page.click('#download');
await until(() => document.querySelector('#toast').textContent === 'Downloaded one file per page, starting with My poster-1.png');
assert.ok([1, 2, 3].every(n => fs.existsSync(out + `My poster-${n}.png`)), 'one PNG per page');
await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
await page.click('#exportBtn'); await page.uncheck('#allPages'); await page.click('#exportBtn');
assert.match((await exportAs('svg', 'My poster.svg')).toString(), /<svg[^>]+width="540"/);
assert.ok((await exportAs('jpeg', 'My poster.jpg')).subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));

const evil = path.join(os.tmpdir(), 'design-editor-evil.json');
assert.equal(await page.evaluate(p => native.saveFile({ ext: 'json', data: 'x', filePath: p }).then(() => 'wrote', () => 'refused'), evil), 'refused');
assert.ok(!fs.existsSync(evil));

await page.click('[data-tab="text"]');
await page.click('[data-text="body"]');
await settle(page);
assert.equal((await win()).edited, true, 'edit after save marks the window edited');
await page.screenshot({ path: out + 'editor.png' });
await app.close();

({ app, page, menu, win } = await launch());
assert.equal(await count(), 10, 'autosave restores unsaved work after relaunch');
assert.deepEqual(await pageOf(), [0, 3], 'with every page');
assert.deepEqual(await win(), { title: 'My poster', edited: true });
await menu('save'); await settle(page);
assert.equal((await win()).edited, false, 'save goes straight to the remembered file');
assert.equal(JSON.parse(fs.readFileSync(out + 'My poster.json', 'utf8')).pages[0].objects.length, 10);
await menu('new'); await settle(page);
assert.deepEqual([await count(), await pageOf()], [0, [0, 1]]);
assert.ok(await page.isDisabled('#pageDel'), 'the last page can’t be deleted');
await menu('open'); await settle(page);
assert.deepEqual([await count(), await pageOf()], [10, [0, 3]], 'open from the File menu');
await app.evaluate((_, p) => { globalThis.nextOpen = p; }, root + 'test/v1.json');
await menu('open'); await settle(page);
assert.deepEqual([await count(), await pageOf(), await page.evaluate(() => editor.size)], [2, [0, 1], [600, 400]], 'a v1 file opens');
assert.match(await page.textContent('#toast'), /^Comic Papyrus Pro isn’t on this Mac/);
assert.equal(await page.evaluate(() => editor.canvas.getObjects()[1].fontFamily), 'Atkinson Hyperlegible Next');
await app.close();

fs.rmSync(data, { recursive: true, force: true });
assert.deepEqual(errors, []);
console.log('e2e ok');
