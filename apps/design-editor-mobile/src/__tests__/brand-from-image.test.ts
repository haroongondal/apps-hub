import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const engine = (f: string) => read(`packages/design-editor-engine/${f}`);

test('both pages carry the "Add colours from an image" picker and the place its colours show', () => {
  for (const f of ['mobile.html', 'desktop.html']) {
    const html = engine(f);
    assert.match(html, /<label[^>]*id="brandFromImage"[^>]*>Add colours from an image<input type="file" id="brandImg" accept="image\/\*" hidden><\/label>/, `${f} has the picker`);
    assert.match(html, /<div id="brandFound"><\/div>/, `${f} has the colour list`);
    assert.ok(html.indexOf('<script src="image-maths.js">') > 0, `${f} loads image-maths.js`);
    assert.ok(html.indexOf('image-maths.js') < html.indexOf('<script src="app.js">'), `${f} loads image-maths.js before app.js`);
  }
  assert.match(engine('build.mjs'), /'image-maths\.js'/, 'the phone bundle inlines image-maths.js');
});

test('on the phone the picker goes through the app, so the page never shows the camera entry', () => {
  assert.match(engine('shell-mobile.js'), /querySelectorAll\('#drop, #brandFromImage'\)/);
});

test('picked colours are read on the device, chosen by the person, saved to the brand kit and sent nowhere', () => {
  const app = engine('app.js');
  const start = app.indexOf("$('#brandImg').onchange");
  const end = app.indexOf("$('#brandHeading').onchange");
  assert.ok(start > 0 && end > start, 'found the brand image block');
  const block = app.slice(start, end);
  assert.match(block, /extractPalette\(downsample\(bitmap\), \{ count: 6 \}\)/);
  assert.match(block, /contrastOf\(hex\)/, 'each colour shows whether text on it reads well');
  assert.match(block, /type="checkbox" \$\{brand\.colors\.includes\(hex\) \? '' : 'checked'\}/, 'colours already in the kit start unticked');
  assert.match(block, /filter\(\(f, i\) => rows\[i\]\.querySelector\('input'\)\.checked && !brand\.colors\.includes\(f\.hex\)\)/, 'only ticked, new colours are added');
  assert.match(block, /brand\.colors\.push\(\.\.\.picked\); saveBrand\(\); renderBrand\(\)/);
  assert.doesNotMatch(block, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.match(app, /function saveBrand\(\) \{ store\.set\('brand', brand\); \}/);
});
