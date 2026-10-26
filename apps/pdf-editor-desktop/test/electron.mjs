import { _electron } from 'playwright-core';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// runs after e2e.mjs, which writes test/in.pdf
const dir = new URL('.', import.meta.url).pathname;
const out = dir + 'electron-out.pdf';
fs.rmSync(out, { force: true });
// hosts like VS Code set ELECTRON_RUN_AS_NODE, which makes Electron start as plain Node
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const app = await _electron.launch({ args: [dir + '..'], env });
// skip the native Save dialog so the test can check the file
await app.evaluate(({ session }, path) => session.defaultSession.on('will-download', (_, item) => item.setSavePath(path)), out);
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setInputFiles('#open', dir + 'in.pdf');
await page.waitForSelector('.slot >> nth=1');
await page.click('#save');
for (let i = 0; i < 50 && !fs.existsSync(out); i++) await new Promise(r => setTimeout(r, 100));
await new Promise(r => setTimeout(r, 300));
await app.close();
assert.deepEqual(errors, []);
assert.equal((await PDFDocument.load(fs.readFileSync(out))).getPageCount(), 2);
console.log('electron ok');
