'use strict';
const { Canvas, StaticCanvas, FabricText, Textbox, Rect, Circle, Triangle, Polygon, Line, FabricImage, Group, Point, filters } = fabric;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// fabric leaves these out of toObject, so locks would vanish on undo and save
const PROPS = ['lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'name'];
const SANS = 'Atkinson Hyperlegible Next';
const BUNDLED = {
  [SANS]: 'ui/fonts/AtkinsonHyperlegibleNext_400Regular ui/fonts/AtkinsonHyperlegibleNext_600SemiBold ui/fonts/AtkinsonHyperlegibleNext_800ExtraBold fonts/AtkinsonHyperlegibleNext_700Bold fonts/AtkinsonHyperlegibleNext_400Regular_Italic fonts/AtkinsonHyperlegibleNext_700Bold_Italic',
  Jost: 'fonts/Jost_400Regular fonts/Jost_700Bold fonts/Jost_400Regular_Italic fonts/Jost_700Bold_Italic',
  'Playfair Display': 'fonts/PlayfairDisplay_400Regular fonts/PlayfairDisplay_700Bold fonts/PlayfairDisplay_400Regular_Italic fonts/PlayfairDisplay_700Bold_Italic',
  'Dancing Script': 'fonts/DancingScript_400Regular fonts/DancingScript_700Bold',
};
const FACES = Object.entries(BUNDLED).flatMap(([family, files]) => files.split(' ').map(f => {
  const [, weight, italic] = /_(\d+)\D+?(_Italic)?$/.exec(f);
  return { family, src: `vendor/${f}.ttf`, weight: +weight, italic: !!italic };
}));
const SYSTEM_FONTS = ['Avenir Next', 'Helvetica Neue', 'Futura', 'Gill Sans', 'Georgia', 'Baskerville', 'Didot', 'Times New Roman', 'American Typewriter', 'Marker Felt', 'Impact', 'Menlo', 'Arial', 'Verdana', 'Trebuchet MS', 'Courier New'];
const fontOptions = sel => [['Included with the app', Object.keys(BUNDLED)], ['This Mac only', SYSTEM_FONTS]]
  .map(([label, list]) => `<optgroup label="${label}">${list.map(f => `<option ${f === sel ? 'selected' : ''}>${esc(f)}</option>`).join('')}</optgroup>`).join('');
async function loadFonts() {
  await Promise.all(FACES.map(f => {
    const face = new FontFace(f.family, `url("${f.src}")`, { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' });
    document.fonts.add(face);
    return face.load();
  })).catch(() => toast('Some bundled fonts didn’t load. Reinstall the app to fix this.', 6000));
}
const cssWeight = w => w === 'bold' ? 700 : +w || 400;
// the CSS font matching rules, so the PDF embeds the same face the canvas drew with
function pickFace(family, weight, italic) {
  const faces = FACES.filter(f => f.family === family), same = faces.filter(f => f.italic === italic);
  const pool = same.length ? same : faces, w = cssWeight(weight);
  const cost = ({ weight: f }) => w > 500 ? (f >= w ? f - w : 1e4 + w - f)
    : w < 400 ? (f <= w ? w - f : 1e4 + f - w)
    : f >= w && f <= 500 ? f - w : f < w ? 1e3 + w - f : 1e4 + f - w;
  return pool.reduce((a, b) => cost(b) < cost(a) ? b : a);
}
const probe = document.createElement('canvas').getContext('2d');
function hasFont(f) {
  if (BUNDLED[f]) return true;
  return ['monospace', 'serif'].some(g => {
    probe.font = `40px ${g}`; const w = probe.measureText('mmmwwwlli10O@').width;
    probe.font = `40px "${f}", ${g}`; return probe.measureText('mmmwwwlli10O@').width !== w;
  });
}
const textsIn = objs => (objs || []).flatMap(o => o.objects ? textsIn(o.objects) : typeof o.fontFamily === 'string' ? [o] : []);
function replaceMissingFonts(d) {
  const missing = new Set();
  for (const t of d.pages.flatMap(p => textsIn(p.objects))) if (!hasFont(t.fontFamily)) { missing.add(t.fontFamily); t.fontFamily = SANS; }
  const names = [...missing];
  if (names.length) toast(`${names.join(', ')} ${names.length > 1 ? 'aren’t' : 'isn’t'} on this Mac, so that text now uses ${SANS}.`, 6000);
}
const PRESETS = [
  ['Instagram post', 1080, 1080], ['Instagram story', 1080, 1920], ['Facebook post', 1200, 630],
  ['YouTube thumbnail', 1280, 720], ['Presentation 16:9', 1920, 1080], ['A4 portrait', 2480, 3508],
  ['Poster 18×24 in', 1800, 2400], ['Business card', 1050, 600], ['LinkedIn banner', 1584, 396],
];

const store = {
  get(k, d) { try { const v = localStorage.getItem('design-editor:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('design-editor:' + k, JSON.stringify(v)); } catch { /* full or blocked; Save to file still works */ } },
};

let W = 1080, H = 1080;
const canvas = new Canvas('c', { preserveObjectStacking: true, backgroundColor: '#ffffff' });
const brand = store.get('brand', { colors: ['#1d2433', '#2f54d8', '#ffd43b', '#ffffff'], heading: 'Jost', body: SANS });
// every page as canvas JSON; the current one lives in `canvas` and pages[cur] is stale until we leave it
let pages = [{}], cur = 0;
const pagesNow = () => pages.map((p, i) => i === cur ? canvas.toObject(PROPS) : p);

function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

let zoom = 1;
function setZoom(z) {
  zoom = Math.min(4, Math.max(0.05, z));
  canvas.setZoom(zoom);
  canvas.setDimensions({ width: Math.round(W * zoom), height: Math.round(H * zoom) });
  $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
}
function fit() {
  const b = $('#board');
  setZoom(Math.min((b.clientWidth - 80) / W, (b.clientHeight - 80) / H));
}
$('#zoomIn').onclick = () => setZoom(zoom * 1.25);
$('#zoomOut').onclick = () => setZoom(zoom / 1.25);
$('#zoomFit').onclick = fit;
window.addEventListener('resize', fit);

let undoStack = [], redoStack = [], restoring = false, saveTimer;
let filePath = null, savedSnap = null;
function snapshot() {
  const all = pagesNow();
  const fonts = [...new Set(all.flatMap(p => textsIn(p.objects).map(t => t.fontFamily)))];
  return JSON.stringify({ version: 2, W, H, fonts, pages: all });
}
const docName = () => filePath ? filePath.split(/[\\/]/).pop().replace(/\.json$/i, '') : 'Untitled';
function docChanged(snap) {
  const dirty = snap !== savedSnap;
  native.setDocState({ title: docName(), dirty, filePath });
  native.writeAutosave({ filePath, dirty, doc: snap }).catch(() => toast('Autosave failed. Save to a file to keep your work.'));
}
function record() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 150);
}
// undo entries remember the page they were made on, kept out of `s` so switching pages never dirties the design
function commit() {
  clearTimeout(saveTimer);
  const s = snapshot();
  if (s === undoStack.at(-1)?.s) return;
  undoStack.push({ s, page: cur }); if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  docChanged(s);
  const img = $('#pageList [aria-current] img'); if (img) img.src = pageThumb(canvas);
}
// accepts v2 { W, H, pages } and v1 { W, H, canvas } files
function parseDoc(text) {
  const d = JSON.parse(text), list = d.pages ?? (d.canvas && [d.canvas]);
  if (!(d.W > 0 && d.H > 0 && Array.isArray(list) && list.length && list.every(p => p && typeof p === 'object'))) throw new Error('not a design file');
  return { W: d.W, H: d.H, pages: list };
}
async function load(d, page = 0) {
  W = d.W; H = d.H; pages = d.pages;
  await openPage(Math.min(page, pages.length - 1));
  updateSize(); fit();
}
const restore = (s, page) => load(parseDoc(s), page);
async function undo() {
  commit();
  if (undoStack.length < 2) return;
  const u = undoStack.pop(); redoStack.push(u);
  await restore(undoStack.at(-1).s, u.page); docChanged(undoStack.at(-1).s);
}
async function redo() {
  if (!redoStack.length) return;
  const r = redoStack.pop(); undoStack.push(r);
  await restore(r.s, r.page); docChanged(r.s);
}

async function openPage(i) {
  restoring = true;
  try { cur = i; await canvas.loadFromJSON(pages[i]); } finally { restoring = false; }
  canvas.requestRenderAll(); inspect(); renderPages();
}
async function showPage(i) {
  if (i === cur || !pages[i]) return;
  commit(); canvas.discardActiveObject();
  pages[cur] = canvas.toObject(PROPS);
  await openPage(i);
}
async function pageOp(op) {
  commit(); canvas.discardActiveObject();
  pages[cur] = canvas.toObject(PROPS);
  let to = cur + 1;
  if (op === 'add') pages.splice(to, 0, { objects: [], background: '#ffffff' });
  else if (op === 'duplicate') pages.splice(to, 0, structuredClone(pages[cur]));
  else if (op === 'delete') { if (pages.length < 2) return; pages.splice(cur, 1); to = Math.min(cur, pages.length - 1); }
  else { to = op === 'left' ? cur - 1 : cur + 1; if (!pages[to]) return; [pages[cur], pages[to]] = [pages[to], pages[cur]]; }
  await openPage(to); record();
}
async function withPage(json, fn) {
  const sc = new StaticCanvas(document.createElement('canvas'), { width: W, height: H, renderOnAddRemove: false, enableRetinaScaling: false });
  try { await sc.loadFromJSON(json); return await fn(sc); } finally { sc.dispose(); }
}
const pageThumb = c => c.toDataURL({ format: 'png', multiplier: 160 / (Math.max(W, H) * c.getZoom()) });
const thumbs = new WeakMap();
function renderPages() {
  const list = $('#pageList'), focused = list.contains(document.activeElement), n = pages.length;
  list.replaceChildren(...pages.map((p, i) => {
    const li = document.createElement('li'), b = document.createElement('button'), img = new Image(), num = document.createElement('span');
    b.className = 'thumb'; b.setAttribute('aria-label', `Page ${i + 1} of ${n}`);
    if (i === cur) { b.setAttribute('aria-current', 'true'); img.src = pageThumb(canvas); }
    else {
      if (!thumbs.has(p)) thumbs.set(p, withPage(p, pageThumb));
      thumbs.get(p).then(u => { img.src = u; }, () => {});
    }
    img.alt = ''; num.textContent = i + 1;
    b.append(img, num); b.onclick = () => showPage(i);
    li.append(b); return li;
  }));
  if (focused) list.querySelector('[aria-current]').focus();
  $('#pageDel').disabled = n < 2; $('#pageLeft').disabled = cur === 0; $('#pageRight').disabled = cur === n - 1;
}
for (const [id, op] of [['pageAdd', 'add'], ['pageDup', 'duplicate'], ['pageDel', 'delete'], ['pageLeft', 'left'], ['pageRight', 'right']]) $('#' + id).onclick = () => pageOp(op);
$('#undo').onclick = undo; $('#redo').onclick = redo;
canvas.on('object:added', record);
canvas.on('object:removed', record);
canvas.on('object:modified', record);
canvas.on('text:changed', record);

function updateSize() {
  $('#sizeLabel').textContent = `${W} × ${H} px`;
  $('#cw').value = W; $('#ch').value = H;
}

const s = () => Math.min(W, H) / 1080;
function place(obj) {
  obj.set({ left: W / 2, top: H / 2 });
  canvas.add(obj);
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
  return obj;
}
function starPoints(r, n = 5) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  });
}
const SHAPES = {
  square: { svg: '<rect x="3" y="3" width="18" height="18"/>', make: () => new Rect({ width: 300 * s(), height: 300 * s(), fill: '#2f54d8' }) },
  rounded: { svg: '<rect x="3" y="3" width="18" height="18" rx="5"/>', make: () => new Rect({ width: 300 * s(), height: 300 * s(), rx: 40 * s(), ry: 40 * s(), fill: '#2f54d8' }) },
  circle: { svg: '<circle cx="12" cy="12" r="9"/>', make: () => new Circle({ radius: 150 * s(), fill: '#2f54d8' }) },
  triangle: { svg: '<path d="M12 3l9 18H3z"/>', make: () => new Triangle({ width: 300 * s(), height: 270 * s(), fill: '#2f54d8' }) },
  star: { svg: '<path d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.3 5.8 21l1.6-7L2 9.3l7.1-.7z"/>', make: () => new Polygon(starPoints(160 * s()), { fill: '#ffd43b' }) },
  line: { svg: '<rect x="2" y="11" width="20" height="2"/>', make: () => new Line([0, 0, 400 * s(), 0], { stroke: '#1d2433', strokeWidth: 8 * s() }) },
};
for (const [k, v] of Object.entries(SHAPES)) {
  const b = document.createElement('button');
  b.className = 'shape'; b.title = k; b.setAttribute('aria-label', 'Add ' + k);
  b.innerHTML = `<svg viewBox="0 0 24 24">${v.svg}</svg>`;
  b.onclick = () => place(v.make());
  $('#shapes').append(b);
}
const TEXT = {
  heading: () => ({ fontSize: 96, fontWeight: 'bold', fontFamily: brand.heading, text: 'Add a heading' }),
  subheading: () => ({ fontSize: 56, fontWeight: '600', fontFamily: brand.heading, text: 'Add a subheading' }),
  body: () => ({ fontSize: 34, fontWeight: 'normal', fontFamily: brand.body, text: 'Add a little bit of body text' }),
};
function makeText(kind) {
  const { text, fontSize, ...rest } = TEXT[kind]();
  return new Textbox(text, { ...rest, fontSize: fontSize * s(), width: W * 0.7, textAlign: 'center', fill: '#1d2433' });
}
$$('[data-text]').forEach(b => b.onclick = () => place(makeText(b.dataset.text)));

const uploads = [];
async function addImage(url) {
  const img = await FabricImage.fromURL(url);
  const k = Math.min(1, (W * 0.6) / img.width, (H * 0.6) / img.height);
  img.set({ scaleX: k, scaleY: k });
  place(img);
}
function readFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const r = new FileReader();
    r.onload = () => {
      uploads.unshift(r.result);
      renderUploads();
      addImage(r.result);
    };
    r.readAsDataURL(f);
  }
}
function renderUploads() {
  $('#uploads').replaceChildren(...uploads.map(u => {
    const b = document.createElement('button'); b.setAttribute('aria-label', 'Add image');
    const i = new Image(); i.src = u; i.alt = ''; b.append(i);
    b.onclick = () => addImage(u);
    return b;
  }));
}
$('#imgFile').onchange = e => { readFiles(e.target.files); e.target.value = ''; };
const drop = $('#drop');
document.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); });
document.addEventListener('paste', e => {
  if (isTyping()) return;
  const files = [...e.clipboardData.items].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
  e.preventDefault();
  if (files.length) readFiles(files);
  else if (clipboard) addClone(clipboard, 24 * s() * ++clipboard.pastes);
});
function copySelection(e) {
  if (isTyping() || !active()) return false;
  e.preventDefault();
  // overwrite the system clipboard so an image copied earlier elsewhere doesn't win the next paste
  e.clipboardData.setData('text/plain', '');
  active().clone(PROPS).then(c => { clipboard = c; c.pastes = 0; });
  return true;
}
document.addEventListener('copy', copySelection);
document.addEventListener('cut', e => copySelection(e) && del());

const TEMPLATES = [
  { name: 'Sale', bg: '#ffd43b', items: () => [
    new Circle({ left: W * 0.82, top: H * 0.18, radius: 220 * s(), fill: '#ff6b6b' }),
    new Textbox('Summer sale', { left: W / 2, top: H * 0.42, width: W * 0.86, fontSize: 150 * s(), fontWeight: 'bold', fontFamily: 'Jost', fill: '#1d2433', textAlign: 'center', lineHeight: 0.95 }),
    new Textbox('Up to 50% off everything in store', { left: W / 2, top: H * 0.62, width: W * 0.8, fontSize: 46 * s(), fontFamily: SANS, fill: '#1d2433', textAlign: 'center' }),
    new Rect({ left: W / 2, top: H * 0.78, width: 420 * s(), height: 100 * s(), rx: 50 * s(), ry: 50 * s(), fill: '#1d2433' }),
    new Textbox('Shop now', { left: W / 2, top: H * 0.78, width: 400 * s(), fontSize: 40 * s(), fontWeight: 'bold', fontFamily: SANS, fill: '#ffd43b', textAlign: 'center' }),
  ] },
  { name: 'Quote', bg: '#1d2433', items: () => [
    new Textbox('“', { left: W / 2, top: H * 0.26, width: W * 0.3, fontSize: 260 * s(), fontFamily: 'Playfair Display', fill: '#5c7cfa', textAlign: 'center' }),
    new Textbox('Design is not just what it looks like. Design is how it works.', { left: W / 2, top: H * 0.5, width: W * 0.78, fontSize: 64 * s(), fontFamily: 'Playfair Display', fontStyle: 'italic', fill: '#ffffff', textAlign: 'center', lineHeight: 1.25 }),
    new Textbox('Steve Jobs', { left: W / 2, top: H * 0.74, width: W * 0.6, fontSize: 34 * s(), fontFamily: SANS, fill: '#aab4c8', textAlign: 'center', charSpacing: 120 }),
  ] },
  { name: 'Event', bg: '#edf2ff', items: () => [
    new Rect({ left: W / 2, top: H * 0.12, width: W, height: H * 0.24, fill: '#2f54d8' }),
    new Textbox('You’re invited', { left: W / 2, top: H * 0.12, width: W * 0.8, fontSize: 64 * s(), fontFamily: 'Dancing Script', fontWeight: '600', fill: '#ffffff', textAlign: 'center' }),
    new Textbox('Studio open night', { left: W / 2, top: H * 0.45, width: W * 0.84, fontSize: 120 * s(), fontFamily: 'Playfair Display', fontWeight: 'bold', fill: '#1d2433', textAlign: 'center', lineHeight: 1 }),
    new Line([0, 0, W * 0.3, 0], { left: W / 2, top: H * 0.62, stroke: '#2f54d8', strokeWidth: 6 * s() }),
    new Textbox('Friday 14 November, 7pm\n22 Market Street', { left: W / 2, top: H * 0.74, width: W * 0.8, fontSize: 44 * s(), fontFamily: SANS, fill: '#1d2433', textAlign: 'center', lineHeight: 1.3 }),
  ] },
  { name: 'Launch', bg: '#ffffff', items: () => [
    new Rect({ left: W * 0.2, top: H / 2, width: W * 0.4, height: H, fill: '#12b886' }),
    new Polygon(starPoints(130 * s()), { left: W * 0.2, top: H / 2, fill: '#ffffff' }),
    new Textbox('New', { left: W * 0.7, top: H * 0.3, width: W * 0.5, fontSize: 48 * s(), fontFamily: SANS, fontWeight: '600', fill: '#12b886' }),
    new Textbox('The everyday bag, rebuilt', { left: W * 0.7, top: H * 0.48, width: W * 0.5, fontSize: 84 * s(), fontFamily: SANS, fontWeight: 'bold', fill: '#1d2433', lineHeight: 1.05 }),
    new Textbox('Lighter, tougher, and out today.', { left: W * 0.7, top: H * 0.7, width: W * 0.5, fontSize: 36 * s(), fontFamily: SANS, fill: '#5b6475' }),
  ] },
];
async function applyTemplate(t) {
  if (canvas.getObjects().length) await pageOp('add');
  restoring = true;
  canvas.clear();
  canvas.backgroundColor = t.bg;
  t.items().forEach(o => canvas.add(o));
  restoring = false;
  canvas.requestRenderAll(); record(); inspect();
}
function templateThumb(t) {
  const sc = new fabric.StaticCanvas(document.createElement('canvas'), { width: W, height: H, backgroundColor: t.bg, renderOnAddRemove: false });
  t.items().forEach(o => sc.add(o));
  const url = sc.toDataURL({ format: 'png', multiplier: 480 / Math.max(W, H) });
  sc.dispose();
  return url;
}
function renderTemplates() {
  $('#templates').replaceChildren(...TEMPLATES.map(t => {
    const b = document.createElement('button');
    b.className = 'tpl'; b.setAttribute('aria-label', t.name + ' template');
    const i = new Image(); i.src = templateThumb(t); i.alt = '';
    b.append(i);
    b.onclick = () => applyTemplate(t);
    return b;
  }));
}

$('#presets').replaceChildren(...PRESETS.map(([n, w, h]) => {
  const b = document.createElement('button');
  b.style.textAlign = 'left';
  b.innerHTML = `${n} <span style="float:right;color:var(--ink-soft)">${w}×${h}</span>`;
  b.onclick = () => { $('#cw').value = w; $('#ch').value = h; };
  return b;
}));
async function resizePage(nw, nh, scaleContent) {
  canvas.discardActiveObject();
  const k = Math.min(nw / W, nh / H);
  const move = objs => { for (const o of objs) {
    const c = o.getCenterPoint();
    const nc = scaleContent ? new Point((c.x - W / 2) * k + nw / 2, (c.y - H / 2) * k + nh / 2) : new Point(c.x - W / 2 + nw / 2, c.y - H / 2 + nh / 2);
    if (scaleContent) o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
    o.setPositionByOrigin(nc, 'center', 'center');
    o.setCoords();
  } };
  for (const [i, p] of pages.entries()) if (i !== cur) pages[i] = await withPage(p, sc => { move(sc.getObjects()); return sc.toObject(PROPS); });
  move(canvas.getObjects());
  W = nw; H = nh;
  updateSize(); fit(); renderTemplates(); renderPages(); record();
}
$('#applySize').onclick = async () => {
  const w = Math.round(+$('#cw').value), h = Math.round(+$('#ch').value);
  if (!(w >= 16 && h >= 16 && w <= 8000 && h <= 8000)) return toast('Use a size between 16 and 8000 px');
  await resizePage(w, h, $('#magic').checked);
  toast(`Resized to ${w} × ${h}`);
};

function saveBrand() { store.set('brand', brand); }
function renderBrand() {
  $('#brandColors').replaceChildren(...brand.colors.map((c, i) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Apply ' + c);
    b.onclick = () => applyColor(c);
    b.oncontextmenu = e => { e.preventDefault(); brand.colors.splice(i, 1); saveBrand(); renderBrand(); };
    return b;
  }));
  for (const id of ['brandHeading', 'brandBody']) {
    $('#' + id).innerHTML = fontOptions(id === 'brandHeading' ? brand.heading : brand.body);
  }
}
$('#brandAdd').onclick = () => { const c = $('#brandPick').value; if (!brand.colors.includes(c)) brand.colors.push(c); saveBrand(); renderBrand(); };
$('#brandHeading').onchange = e => { brand.heading = e.target.value; saveBrand(); };
$('#brandBody').onchange = e => { brand.body = e.target.value; saveBrand(); };
function applyColor(c) {
  const objs = canvas.getActiveObjects();
  if (!objs.length) canvas.backgroundColor = c;
  for (const o of objs) o.type === 'line' ? o.set('stroke', c) : o.set('fill', c);
  canvas.requestRenderAll(); record(); inspect();
}

// shortcut: flood fill of the edge colour, not an AI model; fine on plain backgrounds, swap in an on-device segmentation model for busy photos.
function removeBackground(px, w, h, tol) {
  const bucket = i => ((px[i * 4] >> 4) << 8) | ((px[i * 4 + 1] >> 4) << 4) | (px[i * 4 + 2] >> 4);
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  const counts = new Map();
  for (const i of edge) counts.set(bucket(i), (counts.get(bucket(i)) || 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  let r = 0, g = 0, b = 0, n = 0;
  for (const i of edge) if (bucket(i) === top) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; n++; }
  r /= n; g /= n; b /= n;
  const dist = i => Math.hypot(px[i * 4] - r, px[i * 4 + 1] - g, px[i * 4 + 2] - b);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const i of edge) if (!seen[i] && px[i * 4 + 3] > 0 && dist(i) <= tol) { seen[i] = 1; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || seen[j]) continue;
      seen[j] = 1;
      if (px[j * 4 + 3] > 0 && dist(j) <= tol) queue[tail++] = j;
      else if (dist(j) <= tol * 1.6) px[j * 4 + 3] = Math.min(px[j * 4 + 3], 255 * (dist(j) - tol) / (tol * 0.6));
    }
  }
  return tail;
}
async function removeBg(img, tol) {
  const src = img._originalElement || img.getElement();
  const c = document.createElement('canvas');
  c.width = src.naturalWidth || src.width; c.height = src.naturalHeight || src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const removed = removeBackground(d.data, c.width, c.height, tol);
  ctx.putImageData(d, 0, 0);
  await img.setSrc(c.toDataURL('image/png'));
  canvas.requestRenderAll(); record();
  toast(removed ? 'Background removed' : 'No plain background found at the edges');
}

const active = () => canvas.getActiveObject();
let clipboard = null;
async function addClone(src, offset) {
  const c = await src.clone(PROPS);
  canvas.discardActiveObject();
  c.set({ left: c.left + offset, top: c.top + offset, evented: true });
  if (c.type === 'activeselection') {
    c.canvas = canvas;
    c.forEachObject(x => canvas.add(x));
    c.setCoords();
  } else canvas.add(c);
  canvas.setActiveObject(c); canvas.requestRenderAll();
}
const duplicate = () => active() && addClone(active(), 24 * s());
function del() {
  const objs = canvas.getActiveObjects();
  if (!objs.length || active().isEditing) return;
  canvas.discardActiveObject(); canvas.remove(...objs); canvas.requestRenderAll();
}
function group() {
  const objs = canvas.getActiveObjects(); if (objs.length < 2) return;
  canvas.discardActiveObject();
  restoring = true; canvas.remove(...objs); restoring = false;
  const g = new Group(objs);
  canvas.add(g); canvas.setActiveObject(g); canvas.requestRenderAll();
}
function ungroup() {
  const g = active(); if (!g || g.type !== 'group') return;
  restoring = true;
  const objs = g.removeAll();
  canvas.remove(g); canvas.add(...objs);
  restoring = false;
  canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
  canvas.requestRenderAll(); record();
}
function setLock(o, on) {
  o.set({ lockMovementX: on, lockMovementY: on, lockScalingX: on, lockScalingY: on, lockRotation: on, hasControls: !on });
}
function alignToPage(where) {
  const o = active(); if (!o) return;
  const r = o.getBoundingRect();
  let { x, y } = o.getCenterPoint();
  if (where === 'left') x -= r.left;
  if (where === 'hcenter') x = W / 2;
  if (where === 'right') x += W - (r.left + r.width);
  if (where === 'top') y -= r.top;
  if (where === 'vcenter') y = H / 2;
  if (where === 'bottom') y += H - (r.top + r.height);
  o.setPositionByOrigin(new Point(x, y), 'center', 'center'); o.setCoords();
  canvas.requestRenderAll(); record();
}
function arrange(how) {
  const o = active(); if (!o) return;
  ({ front: () => canvas.bringObjectToFront(o), back: () => canvas.sendObjectToBack(o), forward: () => canvas.bringObjectForward(o), backward: () => canvas.sendObjectBackwards(o) })[how]();
  canvas.requestRenderAll(); record();
}

let guides = { v: false, h: false };
canvas.on('object:moving', e => {
  const o = e.target, c = o.getCenterPoint(), t = 8 / zoom;
  guides = { v: Math.abs(c.x - W / 2) < t, h: Math.abs(c.y - H / 2) < t };
  if (guides.v || guides.h) o.setPositionByOrigin(new Point(guides.v ? W / 2 : c.x, guides.h ? H / 2 : c.y), 'center', 'center');
});
canvas.on('mouse:up', () => { if (guides.v || guides.h) { guides = { v: false, h: false }; canvas.requestRenderAll(); } });
canvas.on('after:render', ({ ctx }) => {
  if (!ctx || !(guides.v || guides.h)) return;
  ctx.save(); ctx.strokeStyle = '#e8368f'; ctx.lineWidth = 1; ctx.beginPath();
  if (guides.v) { ctx.moveTo(W * zoom / 2 + .5, 0); ctx.lineTo(W * zoom / 2 + .5, H * zoom); }
  if (guides.h) { ctx.moveTo(0, H * zoom / 2 + .5); ctx.lineTo(W * zoom, H * zoom / 2 + .5); }
  ctx.stroke(); ctx.restore();
});

const el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
const hex = c => typeof c !== 'string' ? '#000000' : /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? '#' + [...c.slice(1)].map(x => x + x).join('') : '#000000';
const esc = v => String(v).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
function change(o, props) { o.set(props); o.setCoords(); canvas.requestRenderAll(); record(); }
const imgFilter = (o, type) => o.filters?.find(f => f?.type === type);

function inspect() {
  const box = $('#inspector');
  const o = active();
  if (!o) {
    box.replaceChildren(el(`
      <h2>Page</h2>
      <div class="row"><label for="pbg">Background</label><input type="color" id="pbg" value="${hex(canvas.backgroundColor)}"></div>
      <p class="hint">${W} × ${H} px. Change it in Resize.</p>
      <h3>Shortcuts</h3>
      <p class="hint">⌘Z undo, ⇧⌘Z redo, ⌘D duplicate, ⌘C and ⌘V copy and paste, ⌘G group, ⇧⌘G ungroup, arrows nudge, Delete removes.</p>`));
    $('#pbg').oninput = e => { canvas.backgroundColor = e.target.value; canvas.requestRenderAll(); record(); };
    return;
  }
  const multi = o.type === 'activeselection', isText = o instanceof Textbox, isImg = o instanceof FabricImage, isLine = o.type === 'line', isGroup = o.type === 'group';
  const locked = !!o.lockMovementX;
  const hasFill = !multi && !isImg && !isGroup && !isLine;
  const range = (id, label, min, max, step, value) => `<div class="row"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="width:110px"></div>`;
  box.replaceChildren(el(`
    <h2>${multi ? `${o.size()} items` : isText ? 'Text' : isImg ? 'Image' : isGroup ? 'Group' : 'Shape'}</h2>
    ${hasFill ? `<div class="row"><label for="fill">Colour</label><input type="color" id="fill" value="${hex(o.fill)}"></div>` : ''}
    ${!multi && !isImg && !isGroup ? `<div class="row"><label for="stroke">Outline</label><input type="color" id="stroke" value="${hex(o.stroke)}"><input type="number" id="sw" min="0" max="200" style="width:56px" value="${Math.round(o.strokeWidth || 0)}" aria-label="Outline width"></div>` : ''}
    ${o.type === 'rect' ? `<div class="row"><label for="rx">Corner radius</label><input type="number" id="rx" min="0" style="width:72px" value="${Math.round(o.rx || 0)}"></div>` : ''}
    ${range('op', 'Opacity', 0, 1, 0.01, +o.opacity)}
    ${isText ? `
      <h3>Font</h3>
      <select id="ff" aria-label="Font" style="width:100%">${fontOptions(o.fontFamily)}</select>
      <div class="row" style="margin-top:6px"><input type="number" id="fs" min="4" max="2000" value="${Math.round(o.fontSize)}" style="width:72px" aria-label="Font size">
        <button id="fb" class="${['bold', '600', '700', '800', '900'].includes(String(o.fontWeight)) ? 'on' : ''}" aria-label="Bold"><b>B</b></button>
        <button id="fi" class="${o.fontStyle === 'italic' ? 'on' : ''}" aria-label="Italic"><i>I</i></button>
        <button id="fu" class="${o.underline ? 'on' : ''}" aria-label="Underline"><u>U</u></button></div>
      <div class="grid3">${['left', 'center', 'right'].map(a => `<button data-ta="${a}" class="${o.textAlign === a ? 'on' : ''}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div>
      <div class="row" style="margin-top:6px"><label for="lh">Line spacing</label><input type="number" id="lh" min="0.5" max="4" step="0.05" value="${+o.lineHeight}" style="width:72px"></div>
      <div class="row"><label for="cs">Letter spacing</label><input type="number" id="cs" min="-200" max="2000" step="10" value="${+o.charSpacing}" style="width:72px"></div>` : ''}
    ${isImg ? `
      <h3>Remove background</h3>
      ${range('tol', 'Tolerance', 5, 160, 1, 48)}
      <button id="rbg" style="width:100%">Remove background</button>
      <p class="hint">Best on plain or studio backgrounds.</p>
      <h3>Adjust</h3>
      ${range('fbr', 'Brightness', -1, 1, 0.02, +(imgFilter(o, 'Brightness')?.brightness ?? 0))}
      ${range('fco', 'Contrast', -1, 1, 0.02, +(imgFilter(o, 'Contrast')?.contrast ?? 0))}
      ${range('fbl', 'Blur', 0, 1, 0.02, +(imgFilter(o, 'Blur')?.blur ?? 0))}
      <div class="row"><label for="fgr">Black and white</label><input type="checkbox" id="fgr" ${imgFilter(o, 'Grayscale') ? 'checked' : ''}></div>` : ''}
    <h3>Position on page</h3>
    <div class="grid3">
      <button data-al="left">Left</button><button data-al="hcenter">Centre</button><button data-al="right">Right</button>
      <button data-al="top">Top</button><button data-al="vcenter">Middle</button><button data-al="bottom">Bottom</button>
    </div>
    <h3>Layer</h3>
    <div class="grid2"><button data-ar="forward">Forward</button><button data-ar="backward">Backward</button><button data-ar="front">To front</button><button data-ar="back">To back</button></div>
    ${!multi ? `<div class="grid2" style="margin-top:6px"><button id="flipx">Flip horizontal</button><button id="flipy">Flip vertical</button></div>` : ''}
    <h3>Actions</h3>
    <div class="grid2">
      <button id="dup">Duplicate</button>
      ${!multi ? `<button id="lock" class="${locked ? 'on' : ''}">${locked ? 'Unlock' : 'Lock'}</button>` : ''}
      ${multi ? '<button id="grp">Group</button>' : ''}
      ${isGroup ? '<button id="ungrp">Ungroup</button>' : ''}
      <button id="del" class="danger">Delete</button>
    </div>`));

  const on = (id, ev, fn) => { const n = $('#' + id); if (n) n[ev] = fn; };
  on('fill', 'oninput', e => change(o, { fill: e.target.value }));
  on('stroke', 'oninput', e => change(o, { stroke: e.target.value, strokeWidth: o.strokeWidth || 4 }));
  on('sw', 'oninput', e => change(o, { strokeWidth: Math.max(0, +e.target.value), stroke: o.stroke || '#1d2433' }));
  on('rx', 'oninput', e => change(o, { rx: +e.target.value, ry: +e.target.value }));
  on('op', 'oninput', e => change(o, { opacity: +e.target.value }));
  on('ff', 'onchange', e => change(o, { fontFamily: e.target.value }));
  on('fs', 'oninput', e => +e.target.value > 0 && change(o, { fontSize: +e.target.value }));
  on('fb', 'onclick', () => { change(o, { fontWeight: $('#fb').classList.contains('on') ? 'normal' : 'bold' }); inspect(); });
  on('fi', 'onclick', () => { change(o, { fontStyle: o.fontStyle === 'italic' ? 'normal' : 'italic' }); inspect(); });
  on('fu', 'onclick', () => { change(o, { underline: !o.underline }); inspect(); });
  on('lh', 'oninput', e => +e.target.value > 0 && change(o, { lineHeight: +e.target.value }));
  on('cs', 'oninput', e => change(o, { charSpacing: +e.target.value }));
  $$('[data-ta]').forEach(b => b.onclick = () => { change(o, { textAlign: b.dataset.ta }); inspect(); });
  $$('[data-al]').forEach(b => b.onclick = () => alignToPage(b.dataset.al));
  $$('[data-ar]').forEach(b => b.onclick = () => arrange(b.dataset.ar));
  on('flipx', 'onclick', () => change(o, { flipX: !o.flipX }));
  on('flipy', 'onclick', () => change(o, { flipY: !o.flipY }));
  on('dup', 'onclick', duplicate);
  on('del', 'onclick', del);
  on('grp', 'onclick', group);
  on('ungrp', 'onclick', ungroup);
  on('lock', 'onclick', () => { setLock(o, !locked); canvas.requestRenderAll(); record(); inspect(); });
  on('rbg', 'onclick', () => removeBg(o, +$('#tol').value));
  if (isImg) {
    const apply = () => {
      const f = [];
      if (+$('#fbr').value) f.push(new filters.Brightness({ brightness: +$('#fbr').value }));
      if (+$('#fco').value) f.push(new filters.Contrast({ contrast: +$('#fco').value }));
      if (+$('#fbl').value) f.push(new filters.Blur({ blur: +$('#fbl').value }));
      if ($('#fgr').checked) f.push(new filters.Grayscale());
      o.filters = f; o.applyFilters(); canvas.requestRenderAll(); record();
    };
    ['fbr', 'fco', 'fbl'].forEach(id => on(id, 'oninput', apply));
    on('fgr', 'onchange', apply);
  }
}
canvas.on('selection:created', inspect);
canvas.on('selection:updated', inspect);
canvas.on('selection:cleared', inspect);
canvas.on('object:modified', () => active() && inspect());

const isTyping = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) || !!active()?.isEditing;
document.addEventListener('keydown', e => {
  if (isTyping()) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : group(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); del(); }
  else if (k.startsWith('arrow') && active()) {
    e.preventDefault();
    const o = active(), step = e.shiftKey ? 10 : 1;
    if (k === 'arrowleft') o.left -= step;
    if (k === 'arrowright') o.left += step;
    if (k === 'arrowup') o.top -= step;
    if (k === 'arrowdown') o.top += step;
    o.setCoords(); canvas.requestRenderAll(); record();
  }
  else if (k === 'escape') { canvas.discardActiveObject(); canvas.requestRenderAll(); }
});

const download = (ext, data) => native.saveFile({ name: `${docName()}.${ext}`, ext, data });
const dataURLtoBytes = u => Uint8Array.from(atob(u.split(',')[1]), c => c.charCodeAt(0));
const rgba = c => {
  if (typeof c !== 'string' || !c) return null;
  const [r, g, b, a] = new fabric.Color(c).getSource();
  return a > 0 ? [r / 255, g / 255, b / 255, a] : null;
};
const fontData = new Map();
const fontFile = src => {
  if (!fontData.has(src)) fontData.set(src, fetch(src).then(r => r.arrayBuffer()).then(bytes => ({ bytes, fk: fontkit.create(new Uint8Array(bytes)) })));
  return fontData.get(src);
};
async function pdfFont(o, doc, embedded) {
  if (!(o instanceof FabricText && BUNDLED[o.fontFamily] && rgba(o.fill) && !(o.stroke && o.strokeWidth) && !o.shadow && !o.path
    && !o.clipPath && !o.backgroundColor && !o.textBackgroundColor && o.direction !== 'rtl' && o.isEmptyStyles())) return null;
  const italic = o.fontStyle === 'italic' || o.fontStyle === 'oblique', face = pickFace(o.fontFamily, o.fontWeight, italic);
  const { bytes, fk } = await fontFile(face.src);
  if (![...o.text].every(c => c === '\n' || fk.hasGlyphForCodePoint(c.codePointAt(0)))) return null;
  if (!embedded.has(face.src)) embedded.set(face.src, doc.embedFont(bytes, { subset: true }));
  // Chromium fakes a missing italic with a 0.25 skew, so match it
  return { font: await embedded.get(face.src), slant: italic && !face.italic ? 0.25 : 0 };
}
// mirrors FabricText._renderTextCommon and _renderTextDecoration, so glyphs land where the canvas put them
function drawText(doc, page, o, { font, slant }) {
  const P = PDFLib, [r, g, b, a] = rgba(o.fill), size = o.fontSize, left = o._getLeftOffset();
  const ops = [P.pushGraphicsState(), P.concatTransformationMatrix(0.75, 0, 0, -0.75, 0, H * 0.75), P.concatTransformationMatrix(...o.calcTransformMatrix())];
  if (a * o.opacity < 1) ops.push(P.setGraphicsState(page.node.newExtGState('GS', doc.context.obj({ Type: 'ExtGState', ca: a * o.opacity }))));
  ops.push(P.setFillingRgbColor(r, g, b));
  const key = page.node.newFontDictionary(font.name, font.ref);
  let top = o._getTopOffset();
  o._textLines.forEach((line, i) => {
    const x = left + o._getLineLeftOffset(i), base = top + o.getHeightOfLineImpl(i) * (1 - o._fontSizeFraction), box = o.__charBounds[i];
    top += o.getHeightOfLine(i);
    if (!line.length) return;
    const tj = line.flatMap((ch, j) => j < line.length - 1
      ? [font.encodeText(ch), (font.widthOfTextAtSize(ch, size) - (box[j + 1].left - box[j].left)) * 1000 / size]
      : [font.encodeText(ch)]);
    ops.push(P.beginText(), P.setFontAndSize(key, size), P.setTextMatrix(1, 0, slant, -1, x + box[0].left, base),
      P.PDFOperator.of(P.PDFOperatorNames.ShowTextAdjusted, [doc.context.obj(tj)]), P.endText());
    const t = size * o.textDecorationThickness / 1000, w = box.reduce((sum, c) => sum + c.kernedWidth, 0) - o._getWidthOfCharSpacing();
    for (const [type, aligner] of [['underline', 0], ['linethrough', 0.5], ['overline', 1]]) {
      if (o[type]) ops.push(P.rectangle(x, base + o.offsets[type] * size - aligner * t, w, t), P.fill());
    }
  });
  ops.push(P.popGraphicsState());
  page.pushOperators(...ops);
}
async function pdfPage(doc, sc, scale, embedded) {
  const pw = W * 0.75, ph = H * 0.75, page = doc.addPage([pw, ph]), bg = rgba(sc.backgroundColor);
  if (bg) page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: PDFLib.rgb(bg[0], bg[1], bg[2]), opacity: bg[3] });
  sc.backgroundColor = '';
  let run = [];
  const flush = async () => {
    if (!run.length) return;
    const png = await doc.embedPng(dataURLtoBytes(sc.toDataURL({ format: 'png', multiplier: scale, filter: o => run.includes(o) })));
    page.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
    run = [];
  };
  for (const o of sc.getObjects()) {
    if (!o.visible) continue;
    const text = await pdfFont(o, doc, embedded);
    if (!text) { run.push(o); continue; }
    await flush();
    drawText(doc, page, o, text);
  }
  await flush();
}
async function exportAs(fmt, scale, all) {
  canvas.discardActiveObject(); canvas.renderAll();
  if (fmt === 'pdf') {
    const doc = await PDFLib.PDFDocument.create(), embedded = new Map();
    doc.registerFontkit(fontkit);
    for (const p of pagesNow()) await withPage(p, sc => pdfPage(doc, sc, scale, embedded));
    return download('pdf', await doc.save());
  }
  const files = [];
  for (const p of all ? pagesNow() : [pagesNow()[cur]]) files.push(await withPage(p, sc => {
    if (fmt === 'svg') return sc.toSVG();
    if (fmt === 'png-t') sc.backgroundColor = '';
    return dataURLtoBytes(sc.toDataURL({ format: fmt === 'jpeg' ? 'jpeg' : 'png', quality: 0.92, multiplier: scale }));
  }));
  return download({ png: 'png', 'png-t': 'png', jpeg: 'jpg', svg: 'svg' }[fmt], files.length > 1 ? files : files[0]);
}
const menu = $('#exportMenu');
const allPagesShown = () => { $('#allPagesRow').hidden = $('#fmt').value === 'pdf' || pages.length < 2; };
$('#fmt').onchange = allPagesShown;
$('#exportBtn').onclick = () => { allPagesShown(); menu.classList.toggle('open'); $('#exportBtn').setAttribute('aria-expanded', menu.classList.contains('open')); };
document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.classList.remove('open'); });
$('#download').onclick = async () => {
  menu.classList.remove('open');
  const all = !$('#allPagesRow').hidden && $('#allPages').checked;
  try {
    const saved = await exportAs($('#fmt').value, +$('#scale').value, all);
    if (saved) toast((all ? 'Downloaded one file per page, starting with ' : 'Downloaded to ') + saved.split(/[\\/]/).pop());
  } catch (e) { console.error(e); toast('The download didn’t finish. Try again, or pick another format.', 5000); }
};

const discardOk = () => undoStack.at(-1).s === savedSnap || confirm(`Discard unsaved changes to “${docName()}”?`);
async function save(as) {
  const snap = snapshot();
  const p = await native.saveFile({ name: docName() + '.json', ext: 'json', data: snap, filePath: as ? null : filePath });
  if (!p) return;
  filePath = p; savedSnap = snap;
  docChanged(snap); toast('Saved');
}
async function open() {
  commit();
  if (!discardOk()) return;
  const r = await native.openDesign();
  if (!r) return;
  const before = undoStack.at(-1);
  try {
    const d = parseDoc(r.text);
    replaceMissingFonts(d);
    await load(d);
  } catch {
    await restore(before.s, before.page).catch(() => {});
    return toast('That file is not a design saved from this editor. Open a .json file you saved here.', 5000);
  }
  filePath = r.filePath; savedSnap = snapshot(); undoStack = [{ s: savedSnap, page: 0 }]; redoStack = [];
  docChanged(savedSnap); renderTemplates();
}
async function newDesign() {
  commit();
  if (!discardOk()) return;
  await load({ W, H, pages: [{ objects: [], background: '#ffffff' }] });
  filePath = null; savedSnap = snapshot(); undoStack = [{ s: savedSnap, page: 0 }]; redoStack = [];
  docChanged(savedSnap);
}
const typingOr = (cmd, fn) => () => isTyping() ? document.execCommand(cmd) : fn();
const MENU = {
  new: newDesign, open, save: () => save(false), saveAs: () => save(true),
  export: () => { menu.classList.add('open'); $('#fmt').focus(); },
  undo: typingOr('undo', undo), redo: typingOr('redo', redo), duplicate: () => isTyping() || duplicate(),
  zoomIn: () => setZoom(zoom * 1.25), zoomOut: () => setZoom(zoom / 1.25), zoomFit: fit,
};
native.onMenu(cmd => MENU[cmd]?.());

$$('nav.rail button').forEach(b => b.onclick = () => {
  $$('nav.rail button').forEach(x => x.classList.toggle('on', x === b));
  $$('.drawer section').forEach(p => p.classList.toggle('on', p.dataset.panel === b.dataset.tab));
});

(async () => {
  // fabric caches glyph widths per font, so nothing may measure text before the bundled fonts are in
  await loadFonts();
  renderBrand();
  const saved = await native.readAutosave();
  if (saved?.doc) {
    try {
      const d = parseDoc(saved.doc);
      replaceMissingFonts(d);
      await load(d); filePath = saved.filePath || null;
    } catch {
      await load({ W, H, pages: [{ objects: [], background: '#ffffff' }] });
      toast('The last session couldn’t be restored, so this is a new design.', 5000);
    }
  }
  updateSize(); fit(); renderTemplates(); inspect(); renderPages();
  undoStack = [{ s: snapshot(), page: cur }];
  savedSnap = saved?.dirty ? null : undoStack[0].s;
  docChanged(undoStack[0].s);
})();
window.editor = { canvas, MENU, removeBackground, resizePage, exportAs, applyTemplate, pickFace, TEMPLATES, get size() { return [W, H]; }, get page() { return [cur, pages.length]; } };
