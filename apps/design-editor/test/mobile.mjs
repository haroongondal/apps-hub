// Smoke test for the mobile shell (packages/design-editor-engine/mobile.html) in Chrome with
// a device viewport and a fake ReactNativeWebView bridge. Plain classic scripts, same as the
// Expo WebView gets after build.mjs inlining. Skips when the system Chrome binary is missing.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log('mobile smoke skipped: no Chrome at', CHROME);
  process.exit(0);
}

const pageUrl = new URL('../../../packages/design-editor-engine/mobile.html', import.meta.url).href;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
// the page is offline by design: any request to a web host is recorded and refused
const outside = [];
await page.route(/^https?:/, r => { outside.push(r.request().url()); return r.abort(); });

// fake the native bridge before any page script runs, with the SPEC §14.3 wire schema.
// Boot-time calls (readAutosave/writeAutosave) get answered inline, like the real app does;
// ask-and-answer calls (saveFile, confirm, openDesign) stay pending so this test can inspect
// and reply them through reply().
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`));
  window.__bridge = { inbox: [] };
  window.ReactNativeWebView = {
    postMessage: m => {
      window.__bridge.inbox.push(m);
      const msg = JSON.parse(m);
      if (msg.type === 'readAutosave' && window.__editorCommand) {
        window.__editorCommand('reply', { reqId: msg.reqId, ok: true, value: null });
      } else if (msg.type === 'writeAutosave') {
        window.__editorCommand('reply', { reqId: msg.reqId, ok: true, value: true });
      }
    },
  };
  window.__bridge.wait = async (type, match, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const hit = window.__bridge.inbox.map(r => JSON.parse(r)).find(m => m.type === type && (!match || match(m)));
      if (hit) return hit;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('no "' + type + '" message seen');
  };
  window.__bridge.fresh = () => { window.__bridge.inbox.length = 0; };
});
const reply = (msg, value) => page.evaluate(
  ({ id, v }) => window.__editorCommand('reply', { reqId: id, ok: true, value: v }),
  { id: String(msg.reqId), v: value },
);

await page.goto(pageUrl);
assert.equal(await page.evaluate(() => document.body.classList.contains('embedded')), true, 'embedded mode on');
assert.equal((await page.evaluate(() => window.__bridge.wait('ready'))).type, 'ready');

// boot completes, templates render, and the shell's native surface is in place
await page.waitForSelector('.tpl >> nth=3', { state: 'attached' });
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.drawer')).display), 'none', 'no sheet covers the page on launch');
assert.ok(await page.evaluate(() => 'native' in window && typeof window.native.saveFile === 'function'));
const layouts = await page.evaluate(() => ({
  header: getComputedStyle(document.querySelector('header')).display,
  railRow: getComputedStyle(document.querySelector('nav.rail')).flexDirection,
  media: getComputedStyle(document.querySelector('#openMedia')).display,
  pageReorder: getComputedStyle(document.querySelector('#pageLeft')).display,
}));
assert.deepEqual(layouts, { header: 'none', railRow: 'row', media: 'none', pageReorder: 'none' }, 'embedded layout');

// a template applies, autosave and doc state reach the native side, objects get large handles
// (boot itself emits one dirty:false autosave, so wait for the template's dirty record)
await page.evaluate(() => window.editor.applyTemplate(window.editor.TEMPLATES[0]));
const autosave = await page.evaluate(() => window.__bridge.wait('writeAutosave', m => JSON.parse(m.text).dirty === true));
const savedRec = JSON.parse(autosave.text); // { filePath, dirty, doc }
assert.equal(savedRec.dirty, true);
const doc = JSON.parse(savedRec.doc); // snapshot JSON string inside the autosave record
assert.equal(doc.W, 1080);
assert.equal(doc.pages[0].objects.length, 5, 'the sale template has five items');
assert.ok(!('cornerSize' in doc.pages[0].objects[0]), 'touch props stay out of the design JSON');
assert.ok(await page.evaluate(() => window.editor.canvas.getObjects()[0].touchCornerSize === 44), 'handles stamped for touch');
const state = await page.evaluate(() => window.__bridge.wait('docState', m => m.dirty === true));
assert.equal(state.title, 'Untitled');

// menu commands from the native toolbar reach app.js
const count = () => page.evaluate(() => window.editor.canvas.getObjects().length);
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'undo' }));
await page.waitForFunction(() => window.editor.canvas.getObjects().length === 0, null, { timeout: 3000 });
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'redo' }));
await page.waitForFunction(() => window.editor.canvas.getObjects().length === 5, null, { timeout: 3000 });

// save as .json: the page posts saveFile with text, the native side answers a path
const savedJson = await page.evaluate(() => {
  window.__editorCommand('menu', { cmd: 'saveAs' });
  return window.__bridge.wait('saveFile', m => m.ext === 'json');
});
assert.equal(savedJson.name, 'Untitled.json');
assert.ok(savedJson.text && !savedJson.base64, 'json crosses as text');
await reply(savedJson, '/d/Poster.json');
await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Saved');
const clean = await page.evaluate(() => window.__bridge.wait('docState', m => m.title === 'Poster'));
assert.equal(clean.dirty, false, 'saved, clean');

// export PNG at 2× through the embedded flow: the native 'export' menu command opens the
// bottom-sheet popover (#exportBtn itself is hidden in embedded mode), then the sheet's
// Download button exports
const pngRun = page.evaluate(() => window.__bridge.wait('saveFile', m => m.ext === 'png'));
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'export' }));
await page.click('#download');
const pngPost = await pngRun;
assert.equal(pngPost.name, 'Poster.png', 'exports carry the saved title');
assert.ok(pngPost.base64 && !pngPost.text, 'png crosses as base64');
assert.ok(pngPost.base64.length * 3 / 4 < 30_000_000, 'a template export is small');
await reply(pngPost, 'Poster.png');
await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Downloaded to Poster.png');

// the over-30 MB refusal fires before anything is posted, with the SPEC copy
await page.evaluate(() => window.__bridge.fresh());
const refused = await page.evaluate(() =>
  window.native.saveFile({ name: 'big.png', ext: 'png', data: new Uint8Array(30_100_000) }).then(
    v => v,
    () => 'threw',
  ));
assert.equal(refused, null, 'refused exports resolve null, page-side');
assert.deepEqual(await page.evaluate(() => window.__bridge.inbox), [], 'nothing crossed the bridge');
assert.equal(await page.evaluate(() => document.querySelector('#toast').textContent), 'Too large to save on the phone: try 2×');

// window.confirm routes through the bridge: cancel holds the design, discard clears it.
// The canvas is empty here, so the quote template stays on page 1 with three items.
await page.evaluate(() => window.editor.applyTemplate(window.editor.TEMPLATES[1]));
await page.waitForFunction(() => window.editor.canvas.getObjects().length === 3, null, { timeout: 3000 });
await page.evaluate(() => window.__bridge.fresh());
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'new' }));
const asked = await page.evaluate(() => window.__bridge.wait('confirm'));
assert.match(asked.message, /Discard unsaved changes/);
await reply(asked, false);
await page.waitForTimeout(300);
assert.equal(await count(), 3, 'cancel keeps the design');
await page.evaluate(() => window.__bridge.fresh());
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'new' }));
await reply(await page.evaluate(() => window.__bridge.wait('confirm')), true);
await page.waitForFunction(
  () => window.editor.canvas.getObjects().length === 0 && window.editor.page[1] === 1,
  null, { timeout: 3000 },
);

// long-press on an object opens its action sheet and duplicate works from it; closing the
// sheet must also release the fabric wall, or the next drag gets eaten
await page.evaluate(() => window.editor.applyTemplate(window.editor.TEMPLATES[0]));
await page.waitForFunction(() => window.editor.canvas.getObjects().length === 5, null, { timeout: 3000 });
const before = await count();
const spot = await page.evaluate(() => {
  // fabric hit-tests against the upper canvas, not the #board wrapper, so map through its rect
  const r = window.editor.canvas.upperCanvasEl.getBoundingClientRect();
  const o = window.editor.canvas.getObjects()[1];
  const p = o.getCenterPoint(), v = window.editor.canvas.viewportTransform;
  return { x: r.left + p.x * v[0] + v[4], y: r.top + p.y * v[3] + v[5] };
});
await page.evaluate(point => {
  const fire = (type, px, py, buttons) => document.querySelector('#board').dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: px, clientY: py, buttons }));
  fire('pointerdown', point.x, point.y, 1);
}, spot);
await page.waitForSelector('.actsheet:not([hidden])', { timeout: 3000 });
await page.evaluate(point => {
  document.querySelector('#board').dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: point.x, clientY: point.y, buttons: 0 }));
}, spot);
await page.click('[data-a="duplicate"]');
await page.waitForFunction(n => window.editor.canvas.getObjects().length === n, before + 1, { timeout: 3000 });
assert.equal(await page.evaluate(() => window.editor.canvas.upperCanvasEl.style.pointerEvents), '', 'fabric released after the sheet action');

// pinch: two fingers spread, zoom follows the midpoint math and the fabric wall releases
const pinch = await page.evaluate(point => {
  const board = document.querySelector('#board');
  const fire = (type, id, px, py) => board.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, isPrimary: id === 1, pointerType: 'touch', clientX: px, clientY: py, buttons: type === 'pointerup' ? 0 : 1 }));
  const bx = point.x, by = point.y;
  const z0 = window.editor.canvas.getZoom();
  const backing0 = window.editor.canvas.lowerCanvasEl.width;
  fire('pointerdown', 1, bx + 120, by + 300);
  fire('pointerdown', 2, bx + 180, by + 300);
  fire('pointermove', 1, bx + 100, by + 300);
  fire('pointermove', 2, bx + 200, by + 300);
  fire('pointermove', 1, bx + 90, by + 300);
  fire('pointermove', 2, bx + 210, by + 300);
  const live = () => window.editor.canvas.wrapperEl.getBoundingClientRect().width / window.editor.size[0];
  const mid = live();
  const backing = window.editor.canvas.lowerCanvasEl.width;
  for (let i = 0; i < 40; i++) { fire('pointermove', 1, bx + 90, by + 300); fire('pointermove', 2, bx + 210, by + 300); }
  const held = live();
  const wall = window.editor.canvas.upperCanvasEl.style.pointerEvents;
  const label = document.querySelector('#zoomLabel').textContent;
  fire('pointerup', 1, bx + 90, by + 300);
  return { z0, mid, held, backing0, backing, wall, label };
}, spot);
const zEnd = await page.evaluate(() => window.editor.canvas.getZoom());
await page.evaluate(point => {
  document.querySelector('#board').dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 2, pointerType: 'touch', clientX: point.x + 210, clientY: point.y + 300, buttons: 0 }));
}, spot);
assert.ok(Math.abs(pinch.mid - pinch.z0 * 2) < 0.01, `a 2x spread zoomed 2x (${pinch.z0} → ${pinch.mid})`);
assert.ok(Math.abs(pinch.held - pinch.mid) < 1e-6, `holding the pinch does not compound (${pinch.mid} → ${pinch.held})`);
assert.equal(await page.evaluate(() => window.editor.canvas.lowerCanvasEl.width), await page.evaluate(() => Math.round(window.editor.size[0] * window.editor.canvas.getZoom() * window.devicePixelRatio)), 'sharp redraw after release');
assert.equal(pinch.label, Math.round(pinch.mid * 100) + '%', `zoom label followed (${pinch.label})`);
assert.equal(pinch.backing, pinch.backing0, 'preview frames left the backing store alone');
assert.equal(pinch.wall, 'none', 'fabric stayed walled during the gesture');
assert.ok(Math.abs(zEnd - pinch.held) < 1e-9, 'the committed zoom matches the last frame once the fingers lift');
assert.equal(await page.evaluate(() => window.editor.canvas.upperCanvasEl.style.pointerEvents), '', 'fabric released after the fingers lifted');

// the phone's pixel budget: even at max zoom a layer stays under 8 Mpx, and the page can be scrolled
const budget = await page.evaluate(() => {
  const c = window.editor.canvas;
  window.editor.setZoom(4);
  return { z: c.getZoom(), mpx: c.lowerCanvasEl.width * c.lowerCanvasEl.height / 1e6, upper: c.upperCanvasEl.width * c.upperCanvasEl.height / 1e6 };
});
assert.ok(budget.mpx <= 8.1 && budget.upper <= 8.1, `layers stay in budget at max zoom (${budget.mpx.toFixed(1)} Mpx, zoom ${budget.z})`);

// one finger on empty space pans the board; one finger on an object still belongs to fabric
const panned = await page.evaluate(() => {
  const board = document.querySelector('#board');
  const fire = (type, x, y) => board.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
  board.scrollLeft = 0; board.scrollTop = 0;
  fire('pointerdown', 10, 10); fire('pointermove', 10, 30); fire('pointermove', -40, -80); fire('pointerup', -40, -80);
  return { left: board.scrollLeft, top: board.scrollTop };
});
assert.deepEqual(panned, { left: 50, top: 90 }, 'a drag on empty space scrolls the board by the finger move');

// a hostile design can't make the phone fetch anything: the CSP blocks an image src and a
// pattern source that point at a web host, and nothing a normal session does trips it
assert.deepEqual(await page.evaluate(() => window.__csp), [], 'the CSP blocked nothing in a normal session');
const hostile = JSON.stringify({ W: 100, H: 100, pages: [{ objects: [
  { type: 'Image', src: 'https://evil.example/p.gif' },
  { type: 'Rect', width: 50, height: 50, fill: { type: 'pattern', source: 'https://evil.example/q.png' } },
] }] });
await page.evaluate(() => window.__bridge.fresh());
await page.evaluate(() => window.__editorCommand('menu', { cmd: 'open' }));
await reply(await page.evaluate(() => window.__bridge.wait('confirm')), true);
await reply(await page.evaluate(() => window.__bridge.wait('openDesign')), { text: hostile, filePath: '/d/evil.json' });
await page.waitForFunction(() => window.editor.size[0] === 100, null, { timeout: 5000 });
assert.deepEqual(outside, [], 'no request reached a web host');
assert.deepEqual(await page.evaluate(() => window.__csp.sort()), ['img-src https://evil.example/p.gif', 'img-src https://evil.example/q.png'], 'the CSP blocked both');

await browser.close();
assert.deepEqual(errors, [], 'no JS dialogs or errors');
console.log('mobile bridge ok —', doc.pages[0].objects.length, 'template items, png 2×, refuse path, long-press, pinch', pinch.label);
