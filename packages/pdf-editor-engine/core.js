// PDF editor core, shared by the desktop shell (desktop.html) and the mobile
// shell (mobile.html). A classic script on purpose (no ES modules) so both keep
// working from file://. The host boot script calls it with an adapter:
//
//   pdfEditorShell({ savePdf, pickPdf, pickImage, alert, confirm,
//                    emitDocumentLoaded, supports: { dragDrop, keyboard, fileInputs } })
window.pdfEditorShell = function (main) {
  const A = main;
  const S = 1.5, SVG = 'http://www.w3.org/2000/svg';
  const $ = s => document.querySelector(s);
  const sources = [];   // { bytes, doc, lib }
  let pages = [];       // { src, index, rot, vp, annots, slot, frame, pageEl, layer }
  let tool = 'select', sel = null, fileName = 'document';
  const hist = [];

  async function loadPdf(file, append) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // PDF.js detaches the buffer it is given, so pass a copy and keep the original for saving
    // PDF.js 3.x font eval is exploitable (CVE-2024-4367); this is the upstream mitigation
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    if (!append) { sources.length = 0; pages = []; hist.length = 0; sel = null; fileName = file.name.replace(/\.pdf$/i, ''); }
    const src = sources.push({ bytes, doc }) - 1;
    // shortcut: renders every page up front; fine for normal docs, switch to lazy rendering for 300+ page files
    for (let i = 0; i < doc.numPages; i++) {
      const p = await doc.getPage(i + 1);
      const pg = { src, index: i, rot: 0, vp: p.getViewport({ scale: 1 }), annots: [], pdfPage: p };
      buildPage(pg, p);
      pages.push(pg);
    }
    const displayName = sources.length > 1 ? `${fileName} (+${sources.length - 1} merged)` : file.name;
    $('#name').textContent = displayName;
    $('#save').disabled = false;
    layout();
    if (tool === 'edittext') analyzeAll();
    A.emitDocumentLoaded({ ok: true, name: displayName, pages: pages.length });
  }

  async function analyzeAll() {
    for (const pg of pages) {
      if (pg.text || pg.analyzing) continue;
      pg.analyzing = true;
      const s = sources[pg.src];
      try {
        s.lib ??= await PDFLib.PDFDocument.load(s.bytes, { ignoreEncryption: true });
        pg.text = await analyzePageText(pg.pdfPage, s.lib, pg.index, pg.vp);
      } catch (err) { pg.text = { groups: [], error: err.message }; }
      renderAnnots(pg);
    }
  }

  // Edited text hides the canvas glyphs under it, so paint the box in the page's own colours, not white on black.
  function pageInk(pg, [x0, y0, x1, y1]) {
    const c = pg.canvas, k = c.width / pg.vp.width, m = 2;
    const sx = Math.max(0, Math.floor(x0 * k) - m), sy = Math.max(0, Math.floor(y0 * k) - m);
    const w = Math.min(c.width - sx, Math.ceil((x1 - x0) * k) + 2 * m), h = Math.min(c.height - sy, Math.ceil((y1 - y0) * k) + 2 * m);
    if (w <= 0 || h <= 0) return null;
    const d = c.getContext('2d').getImageData(sx, sy, w, h).data, counts = new Map();
    const at = i => [d[i], d[i + 1], d[i + 2], d[i + 3]];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const p = at((y * w + x) * 4).join(); counts.set(p, (counts.get(p) ?? 0) + 1); }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const p = at((y * w + x) * 4).join(); counts.set(p, (counts.get(p) ?? 0) + 1); }
    const bg = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    if (bg[3] === 0) return null; // not painted yet
    let ink = bg, far = -1;
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (dist > far) { far = dist; ink = at(i); }
    }
    const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
    return { bg: css(bg), ink: css(ink) };
  }

  function textBox(pg, g) {
    const e = document.createElement('div'), [x0, y0, x1, y1] = g.box;
    pg.painted.then(() => {
      const ink = pageInk(pg, g.box);
      if (ink) e.style.setProperty('--tb-bg', ink.bg), e.style.setProperty('--tb-ink', ink.ink);
    });
    e.className = 'tbox' + (g.newText !== undefined ? ' edited' : '');
    Object.assign(e.style, { left: x0 * S + 'px', top: y0 * S + 'px', minWidth: (x1 - x0) * S + 'px', height: (y1 - y0) * S + 'px', lineHeight: (y1 - y0) * S + 'px', fontSize: g.em * S + 'px', ...cssFontFor(g.face) });
    e.textContent = g.newText ?? g.text;
    if (tool === 'edittext') e.contentEditable = 'plaintext-only';
    e.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); e.blur(); } };
    e.oninput = () => {
      const v = e.innerText.replace(/\n/g, ' ');
      g.newText = v === g.text ? undefined : v;
      e.classList.toggle('edited', g.newText !== undefined);
    };
    return e;
  }

  function buildPage(pg, pdfPage) {
    const W = pg.vp.width * S, H = pg.vp.height * S, dpr = devicePixelRatio || 1;
    const canvas = Object.assign(document.createElement('canvas'), { width: W * dpr, height: H * dpr });
    Object.assign(canvas.style, { width: W + 'px', height: H + 'px' });
    pg.canvas = canvas;
    pg.painted = pdfPage.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), viewport: pdfPage.getViewport({ scale: S * dpr }) }).promise.catch(() => {});
    pg.layer = Object.assign(document.createElement('div'), { className: 'layer' });
    pg.pageEl = Object.assign(document.createElement('div'), { className: 'page' });
    Object.assign(pg.pageEl.style, { width: W + 'px', height: H + 'px' });
    pg.pageEl.append(canvas, pg.layer);
    pg.frame = Object.assign(document.createElement('div'), { className: 'frame' });
    pg.frame.append(pg.pageEl);
    pg.bar = Object.assign(document.createElement('div'), { className: 'pbar' });
    pg.slot = Object.assign(document.createElement('div'), { className: 'slot' });
    pg.slot.append(pg.bar, pg.frame);
    wireLayer(pg);
  }

  const ICONS = {
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    left: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    right: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  // The page crossing the viewport's middle line is the one the page rail marks as current.
  const spy = new IntersectionObserver(entries => entries.forEach(e => {
    if (!e.isIntersecting) return;
    document.querySelectorAll('.slot[aria-current]').forEach(s => s.removeAttribute('aria-current'));
    e.target.setAttribute('aria-current', 'page');
  }), { rootMargin: '-50% 0px -50% 0px' });

  function layout() {
    $('#pages').replaceChildren(...pages.map((pg, n) => {
      const W = pg.vp.width * S, H = pg.vp.height * S, side = pg.rot % 180 !== 0;
      Object.assign(pg.frame.style, { width: (side ? H : W) + 'px', height: (side ? W : H) + 'px' });
      pg.pageEl.style.transform = `translate(-50%,-50%) rotate(${pg.rot}deg)`;
      const btn = (icon, title, fn, off) => {
        const b = document.createElement('button');
        b.className = 'ui-btn ui-btn--ghost ui-btn--icon';
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
        b.title = title; b.setAttribute('aria-label', title); b.disabled = !!off; b.onclick = fn; return b;
      };
      pg.bar.replaceChildren(
        Object.assign(document.createElement('span'), { className: 'pnum', textContent: `Page ${n + 1} of ${pages.length}` }),
        btn('up', 'Move up', () => move(n, -1), n === 0),
        btn('down', 'Move down', () => move(n, 1), n === pages.length - 1),
        btn('left', 'Rotate left', () => { pg.rot = (pg.rot + 270) % 360; layout(); }),
        btn('right', 'Rotate right', () => { pg.rot = (pg.rot + 90) % 360; layout(); }),
        btn('trash', 'Delete page', async () => { if (await A.confirm(`Delete page ${n + 1}?`)) { pages.splice(n, 1); layout(); } }, pages.length === 1),
      );
      renderAnnots(pg);
      return pg.slot;
    }));
    spy.disconnect();
    pages.forEach(pg => spy.observe(pg.slot));
    if (!pages.length) $('#pages').innerHTML = '<p id="empty">Open a PDF to start.</p>';
  }

  function move(n, d) { [pages[n], pages[n + d]] = [pages[n + d], pages[n]]; layout(); }

  function renderAnnots(pg) {
    const boxes = (pg.text?.groups || []).filter(g => tool === 'edittext' || g.newText !== undefined).map(g => textBox(pg, g));
    pg.layer.replaceChildren(...boxes, ...pg.annots.map(a => {
      let e;
      if (a.type === 'draw') {
        e = document.createElementNS(SVG, 'svg');
        e.setAttribute('viewBox', `0 0 ${pg.vp.width} ${pg.vp.height}`);
        const pl = document.createElementNS(SVG, 'polyline');
        pl.setAttribute('points', a.pts.map(p => p.join(',')).join(' '));
        Object.entries({ fill: 'none', stroke: a.color, 'stroke-width': a.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }).forEach(([k, v]) => pl.setAttribute(k, v));
        e.append(pl);
      } else {
        e = document.createElement(a.type === 'image' ? 'img' : 'div');
        Object.assign(e.style, { left: a.x * S + 'px', top: a.y * S + 'px' });
        if (a.type !== 'text') Object.assign(e.style, { width: a.w * S + 'px', height: a.h * S + 'px' });
        if (a.type === 'rect') Object.assign(e.style, { background: a.color, opacity: a.opacity });
        if (a.type === 'image') { e.src = a.data; e.draggable = false; e.alt = ''; }
        if (a.type === 'text') {
          Object.assign(e.style, { fontSize: a.size * S + 'px', color: a.color });
          e.textContent = a.text;
          e.contentEditable = tool === 'text' ? 'plaintext-only' : 'false';
          e.oninput = () => { a.text = e.innerText; };
          e.onblur = () => { if (!a.text.trim()) { remove(pg, a); } };
        }
      }
      e.classList.add('annot', a.type === 'rect' ? 'rect' : a.type);
      if (a === sel) e.classList.add('sel');
      e.annot = a;
      return e;
    }));
  }

  function local(pg, e) {
    // Derive css-px-per-pt from the box itself, so CSS scaling (the mobile
    // width-fit transform) cannot skew coordinates; it equals S on desktop.
    const r = pg.pageEl.getBoundingClientRect();
    const pt = r.width / (pg.rot % 180 ? pg.vp.height : pg.vp.width);
    const t = -pg.rot * Math.PI / 180;
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    return [(dx * Math.cos(t) - dy * Math.sin(t)) / pt + pg.vp.width / 2, (dx * Math.sin(t) + dy * Math.cos(t)) / pt + pg.vp.height / 2];
  }

  function add(pg, a) { pg.annots.push(a); hist.push([pg, a]); return a; }
  function remove(pg, a) { pg.annots = pg.annots.filter(x => x !== a); if (sel === a) sel = null; renderAnnots(pg); }
  const style = () => ({ color: $('#color').value, size: +$('#size').value || 14 });

  let pendingImage = null;

  function wireLayer(pg) {
    let drag = null;
    pg.layer.addEventListener('pointerdown', e => {
      if (tool === 'edittext') {
        if (pg.text?.error) A.alert(`Text on this page can't be edited: ${pg.text.error}`);
        return;
      }
      const hit = e.target.closest('.annot')?.annot;
      const [x, y] = local(pg, e);
      if (tool === 'text' && hit?.type === 'text') return;
      e.preventDefault();
      if (tool === 'select') {
        sel = hit || null;
        pages.forEach(renderAnnots);
        if (hit) drag = { kind: 'move', a: hit, last: [x, y] };
      } else if (tool === 'text') {
        const a = add(pg, { type: 'text', x, y: y - style().size * 0.6, text: '', ...style() });
        renderAnnots(pg);
        [...pg.layer.children].find(c => c.annot === a).focus();
      } else if (tool === 'draw') {
        drag = { kind: 'draw', a: add(pg, { type: 'draw', pts: [[x, y]], ...style() }) };
      } else if (tool === 'highlight' || tool === 'whiteout') {
        const hl = tool === 'highlight';
        drag = { kind: 'rect', from: [x, y], a: add(pg, { type: 'rect', x, y, w: 0, h: 0, color: hl ? $('#color').value : '#ffffff', opacity: hl ? 0.35 : 1 }) };
      } else if (tool === 'image') {
        pendingImage = { pg, x, y };
        A.pickImage(pages.indexOf(pg), x, y);
      }
      if (drag) pg.layer.setPointerCapture(e.pointerId);
    });
    pg.layer.addEventListener('pointermove', e => {
      if (!drag) return;
      const [x, y] = local(pg, e), a = drag.a;
      if (drag.kind === 'move') {
        const dx = x - drag.last[0], dy = y - drag.last[1];
        drag.last = [x, y];
        if (a.pts) a.pts = a.pts.map(([px, py]) => [px + dx, py + dy]); else { a.x += dx; a.y += dy; }
      } else if (drag.kind === 'draw') a.pts.push([x, y]);
      else if (drag.kind === 'rect') {
        a.x = Math.min(x, drag.from[0]); a.y = Math.min(y, drag.from[1]);
        a.w = Math.abs(x - drag.from[0]); a.h = Math.abs(y - drag.from[1]);
      }
      renderAnnots(pg);
    });
    pg.layer.addEventListener('pointerup', () => {
      if (drag?.kind === 'rect' && drag.a.w < 3 && drag.a.h < 3) remove(pg, drag.a);
      drag = null;
    });
  }

  // normalise every format to PNG so saving only needs embedPng
  function placeImage(pg, x, y, img) {
    const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext('2d').drawImage(img, 0, 0);
    const w = Math.min(200, img.naturalWidth);
    add(pg, { type: 'image', x, y, w, h: w * img.naturalHeight / img.naturalWidth, data: c.toDataURL('image/png') });
    renderAnnots(pg);
  }

  if (A.supports.fileInputs) {
    $('#imgpick').onchange = async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f || !pendingImage) return;
      const img = new Image();
      img.src = URL.createObjectURL(f);
      const { pg, x, y } = pendingImage;
      pendingImage = null;
      try { await img.decode(); } catch { return A.alert('Could not read that image.'); }
      URL.revokeObjectURL(img.src);
      placeImage(pg, x, y, img);
    };
  }

  function setTool(t) {
    tool = t; document.body.dataset.tool = t;
    if (t === 'edittext') analyzeAll();
    document.querySelectorAll('button[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
    pages.forEach(renderAnnots);
  }
  document.querySelectorAll('button[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));

  function deleteSelected() { const pg = pages.find(p => p.annots.includes(sel)); if (pg) remove(pg, sel); }
  function undo() {
    while (hist.length) {
      const [pg, a] = hist.pop();
      if (pg.annots.includes(a)) return remove(pg, a);
    }
  }
  $('#del').onclick = deleteSelected;
  $('#undo').onclick = undo;
  if (A.supports.keyboard) {
    document.addEventListener('keydown', e => {
      if (e.target.isContentEditable || e.target.tagName === 'INPUT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); }
    });
  }

  const openFile = (f, append) => f && loadPdf(f, append && sources.length > 0).catch(err => {
    A.alert('Could not open PDF: ' + err.message);
    A.emitDocumentLoaded({ ok: false, name: f?.name ?? fileName, error: err.message });
  });
  if (A.supports.fileInputs) {
    $('#open').onchange = e => { openFile(e.target.files[0], false); e.target.value = ''; };
    $('#merge').onchange = e => { openFile(e.target.files[0], true); e.target.value = ''; };
  }
  if (A.supports.dragDrop) {
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', async e => {
      e.preventDefault();
      const append = sources.length > 0 && await A.confirm('Append to the current document? (Cancel replaces it)');
      openFile(e.dataTransfer.files[0], append);
    });
  }

  const toRgb = h => PDFLib.rgb(...[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));

  async function buildPdf() {
    const { PDFDocument, StandardFonts, degrees, LineCapStyle } = PDFLib;
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica), fontCache = new Map();
    // shortcut: encrypted PDFs load with ignoreEncryption and may save broken; decrypt them first (e.g. qpdf --decrypt)
    const copied = await Promise.all(sources.map(async (s, src) => {
      const lib = await PDFDocument.load(s.bytes, { ignoreEncryption: true });
      const idx = pages.filter(p => p.src === src).map(p => p.index);
      const cp = await out.copyPages(lib, idx);
      return new Map(idx.map((i, k) => [i, cp[k]]));
    }));
    for (const pg of pages) {
      const p = copied[pg.src].get(pg.index);
      out.addPage(p);
      p.setRotation(degrees((p.getRotation().angle + pg.rot) % 360));
      if (pg.text?.groups?.some(g => g.newText !== undefined)) {
        const bytes = await rewritePageText(pg.text, out, p, fontCache);
        p.node.set(PDFLib.PDFName.of('Contents'), out.context.obj([out.context.register(out.context.flateStream(bytes))]));
      }
      const P = (x, y) => pg.vp.convertToPdfPoint(x, y);
      const box = a => { const [x1, y1] = P(a.x, a.y), [x2, y2] = P(a.x + a.w, a.y + a.h); return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }; };
      for (const a of pg.annots) {
        if (a.type === 'rect') p.drawRectangle({ ...box(a), color: toRgb(a.color), opacity: a.opacity });
        if (a.type === 'image') p.drawImage(await out.embedPng(await (await fetch(a.data)).arrayBuffer()), box(a));
        if (a.type === 'draw') for (let i = 1; i < a.pts.length; i++) {
          const [sx, sy] = P(...a.pts[i - 1]), [ex, ey] = P(...a.pts[i]);
          p.drawLine({ start: { x: sx, y: sy }, end: { x: ex, y: ey }, thickness: a.size, color: toRgb(a.color), lineCap: LineCapStyle.Round });
        }
        // shortcut: Helvetica (WinAnsi) only, so non-Latin text fails to save, and text on pages with a built-in /Rotate is drawn unrotated; embed a TTF via fontkit if needed
        if (a.type === 'text') a.text.split('\n').forEach((line, i) => {
          const [x, y] = P(a.x, a.y + a.size * (0.9 + 1.2 * i));
          p.drawText(line, { x, y, size: a.size, font, color: toRgb(a.color) });
        });
      }
    }
    return out.save();
  }

  $('#save').onclick = async () => {
    try {
      A.savePdf(await buildPdf(), `${fileName}-edited.pdf`);
    } catch (err) { A.alert('Save failed: ' + err.message); }
  };

  // Native-side command entry for bridge pushes (mobile): open/image/toast.
  window.__editorCommand = (type, payload = {}) => {
    if (type === 'open') {
      const bytes = Uint8Array.from(atob(payload.base64), c => c.charCodeAt(0));
      openFile(new File([bytes], payload.name || 'document.pdf', { type: 'application/pdf' }), payload.append);
    } else if (type === 'image') {
      const target = pendingImage || { pg: pages[payload.pageIndex], x: payload.x, y: payload.y };
      pendingImage = null;
      if (!payload.ok || !target.pg) return A.alert('Could not read that image.');
      const img = new Image();
      img.src = 'data:;base64,' + payload.base64;
      img.decode().then(() => placeImage(target.pg, target.x, target.y, img)).catch(() => A.alert('Could not read that image.'));
    } else if (type === 'toast') {
      A.alert(payload.message);
    }
  };
};
