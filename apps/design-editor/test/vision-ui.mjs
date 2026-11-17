// Cut-out and Upscale in the phone inspector against a fake window.native.vision; the bridge has its own test.
import assert from 'node:assert/strict';

export async function run({ page }) {
  await page.evaluate(() => {
    const png = (w, h, fill) => new Promise(ok => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = fill; x.fillRect(0, 0, w, h); c.toBlob(ok, 'image/png');
    });
    const v = window.__vision = { calls: [], png };
    window.native.vision = async req => {
      v.calls.push({ op: req.op, kind: req.kind, scale: req.scale, type: req.image?.type });
      if (req.op === 'tools') return ['person', 'object', 'sky'];
      if (req.op === 'cancel') { v.req = null; return v.held?.(null); }
      if (req.op === 'cutout') {
        if (req.kind === 'person') throw new Error('Connect to the internet once to get this tool.');
        return png(64, 48, 'rgba(0, 128, 0, 0.5)');
      }
      v.req = req;
      req.onProgress('download', 0.5);
      return new Promise(ok => { v.held = ok; });
    };
  });
  // waitForFunction polls with eval, which the page's CSP blocks
  const until = async (fn, arg) => {
    for (let i = 0; i < 100; i++) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(50); }
    throw new Error('timed out waiting for ' + fn);
  };
  const toast = t => until(t => document.querySelector('#toast').textContent === t, t);
  const img = () => page.evaluate(() => {
    const o = window.editor.canvas.getActiveObject(), e = o._originalElement;
    return { src: o.getSrc(), w: e.naturalWidth, h: e.naturalHeight, sw: Math.round(o.getScaledWidth()), sh: Math.round(o.getScaledHeight()) };
  });
  const undo = async src => {
    await page.waitForTimeout(400); // record() commits after 150 ms
    await page.evaluate(() => { document.activeElement?.blur(); window.__editorCommand('menu', { cmd: 'undo' }); }); // a focused input turns undo into text undo
    await until(src => window.editor.canvas.getObjects().some(o => o.getSrc?.() === src), src);
    await page.evaluate(src => { const c = window.editor.canvas; c.setActiveObject(c.getObjects().find(o => o.getSrc?.() === src)); }, src);
  };
  const red = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const x = c.getContext('2d'); x.fillStyle = '#d00'; x.fillRect(0, 0, 64, 48);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#imgFile', { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(red, 'base64') });
  await page.waitForSelector('[data-cut]', { timeout: 5000 });
  const labels = sel => page.locator(sel).evaluateAll(l => l.map(b => b.textContent));
  assert.deepEqual(await labels('[data-cut]'), ['Person', 'Object'], 'only the kinds the phone offers, unknown ones dropped');
  assert.deepEqual(await labels('#rbg'), ['Plain background']);
  assert.deepEqual(await labels('[data-up]'), ['2x', '4x']);
  const orig = await img();
  await page.waitForTimeout(400); // let the insert commit as its own undo step

  await page.click('[data-cut="object"]');
  await toast('Background removed');
  const cut = await img();
  assert.match(cut.src, /^data:image\/png;base64,/);
  assert.notEqual(cut.src, orig.src);
  assert.deepEqual([cut.sw, cut.sh], [orig.sw, orig.sh], 'same size on the page');
  assert.deepEqual(await page.evaluate(() => window.__vision.calls.find(c => c.op === 'cutout')), { op: 'cutout', kind: 'object', scale: undefined, type: 'image/png' });
  await undo(orig.src);

  await page.click('[data-cut="person"]');
  await toast('Connect to the internet once to get this tool.');
  assert.equal((await img()).src, orig.src, 'an error changes nothing');

  await page.click('[data-up="2"]');
  assert.equal(await page.textContent('#vest'), 'A few seconds on this phone. The result is 128 × 96 px.');
  await page.click('#vno');
  assert.equal(await page.locator('#vest').count(), 0);
  await page.click('[data-up="4"]');
  assert.equal(await page.textContent('#vest'), 'A few seconds on this phone. The result is 256 × 192 px.');

  await page.click('#vgo');
  await until(() => window.__vision.req && document.querySelector('#vbox progress'));
  const bar = () => page.evaluate(() => [document.querySelector('#vbox .hint').textContent, document.querySelector('#vbox progress').value]);
  assert.deepEqual(await bar(), ['Getting the tool', 0.5]);
  await page.evaluate(() => window.__vision.req.onProgress('run', 0.25));
  assert.deepEqual(await bar(), ['Upscaling. A few seconds.', 0.25]);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-up], [data-cut], #rbg')].every(b => b.disabled)), 'other tools wait');
  await page.click('#vstop');
  await page.waitForSelector('#vstop', { state: 'detached', timeout: 5000 });
  assert.equal((await img()).src, orig.src, 'cancel changes nothing');
  assert.ok(await page.evaluate(() => window.__vision.calls.some(c => c.op === 'cancel')));

  await page.click('[data-up="4"]');
  await page.click('#vgo');
  await until(() => window.__vision.req && document.querySelector('#vstop'));
  await page.evaluate(() => window.__vision.png(256, 192, '#d00').then(b => window.__vision.held(b)));
  await toast('Image upscaled');
  const up = await img();
  assert.deepEqual([up.w, up.h, up.sw, up.sh], [256, 192, orig.sw, orig.sh], '4x the pixels, same size on the page');
  assert.match(up.src, /^data:image\/png;base64,/);
  await undo(orig.src);
  assert.equal((await img()).w, 64);

  const calls = await page.evaluate(() => window.__vision.calls.length);
  await page.evaluate(() => { const c = window.editor.canvas; c.remove(c.getActiveObject()); c.discardActiveObject(); });
  const wide = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 4096; c.height = 4;
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#imgFile', { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(wide, 'base64') });
  await until(() => window.editor.canvas.getActiveObject()?._originalElement?.naturalWidth === 4096);
  await page.click('[data-up="4"]');
  await toast('This image is already as big as it can be.');
  assert.equal(await page.evaluate(() => window.__vision.calls.length), calls, 'refused before anything is sent');
  await page.evaluate(() => { const c = window.editor.canvas; c.remove(c.getActiveObject()); c.discardActiveObject(); delete window.native.vision; });
}
