'use strict';
// Mobile touch layer, loaded only by mobile.html, right after app.js (it needs window.editor).
// - two fingers: pinch zoom anchored on the previous midpoint plus a pan by the midpoint's
//   move; Fabric is walled off for the whole gesture (upper canvas pointer-events: none, and
//   a stale drag transform is dropped) so page scrolling never fights it. Fabric is released
//   once every finger lifts; the finger that started the gesture can't start a drag.
// - one finger and the mouse keep Fabric's own select, drag and text editing.
// - long-press (500 ms, stays within 12 px) on an object selects it and opens its action sheet:
//   duplicate, delete, bring forward, send backward, and on an image in the phone app Copy text
//   (reads the picture on the device and copies the line under the finger). Fabric is walled off
//   while the sheet shows.
// - objects get larger handles (cornerSize/touchCornerSize/padding); these are interaction props
//   Fabric never serialises (checked against toObject), so saves stay clean and undo restores
//   them automatically because reopening a page fires object:added.
(() => {
  const editor = window.editor;
  const canvas = editor.canvas;
  const board = document.querySelector('#board');
  const TOUCH = { cornerSize: 24, touchCornerSize: 44, padding: 8 };
  canvas.on('object:added', ({ target: o }) => o.set(TOUCH));
  canvas.selection = false; // no marquee on a phone: a drag on empty space pans the board instead

  // the inspector sheet only matters while something is selected (mobile.html hides it otherwise)
  const syncSelected = () => document.body.classList.toggle('obj', !!canvas.getActiveObject());
  for (const ev of ['selection:created', 'selection:updated', 'selection:cleared', 'object:removed']) canvas.on(ev, syncSelected);

  // keep the selected item above the property sheet: once the finger is up (a layout shift during a
  // drag would move the item under it), the board gets room below the page and scrolls if needed
  const inspector = document.querySelector('#inspector');
  function keepVisible() {
    const o = canvas.getActiveObject();
    document.body.classList.toggle('room', !!o);
    if (!o) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sheetTop = inspector.getBoundingClientRect().top - 12;
      const r = o.getBoundingRect(), w = canvas.wrapperEl.getBoundingClientRect(), z = canvas.getZoom(); // scene units, so scale by the zoom
      const top = w.top + r.top * z, bottom = top + r.height * z;
      const limit = Math.max(0, top - (board.getBoundingClientRect().top + 8)); // never scroll the item's top off the screen
      if (bottom > sheetTop) board.scrollTop += Math.min(bottom - sheetTop, limit);
    }));
  }
  canvas.on('mouse:up', keepVisible);
  for (const ev of ['selection:created', 'selection:updated']) canvas.on(ev, () => setTimeout(() => { if (!pts.size) keepVisible(); }, 0));
  canvas.on('selection:cleared', () => document.body.classList.remove('room'));

  // the Done closer for each drawer sheet; app.js's rail handler re-syncs on the next tap, and
  // the active tab's highlight is kept in step with the now-closed sheet
  for (const sec of document.querySelectorAll('.drawer section')) {
    const done = document.createElement('button');
    done.className = 'sheetdone';
    done.textContent = 'Done';
    done.onclick = () => {
      for (const sel of document.querySelectorAll('.drawer section.on')) sel.classList.remove('on');
      const on = new Set([...document.querySelectorAll('.drawer section.on')].map(s => s.dataset.panel));
      for (const b of document.querySelectorAll('nav.rail button[data-tab]')) b.classList.toggle('on', on.has(b.dataset.tab));
    };
    sec.append(done);
  }

  // ---- the long-press action sheet ----
  const sheet = document.createElement('div');
  sheet.className = 'actsheet';
  sheet.hidden = true;
  sheet.innerHTML = '<button data-a="duplicate">Duplicate</button>'
    + '<button data-a="forward">Bring forward</button><button data-a="backward">Send backward</button>'
    + '<button data-a="ocr" hidden>Copy text</button>'
    + '<button data-a="delete" class="danger">Delete</button><button data-a="close">Cancel</button>';
  document.body.append(sheet);
  sheet.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'close') { closeSheet(); return; }
    if (!a) return;
    const o = canvas.getActiveObject();
    if (a === 'ocr') { if (o instanceof fabric.FabricImage && pressAt) copyText(o, pressAt); }
    else if (a === 'duplicate') editor.MENU.duplicate();
    else if (a === 'forward' && o) { canvas.bringObjectForward(o); canvas.requestRenderAll(); canvas.fire('object:modified', { target: o }); }
    else if (a === 'backward' && o) { canvas.sendObjectBackwards(o); canvas.requestRenderAll(); canvas.fire('object:modified', { target: o }); }
    else if (a === 'delete' && o && !o.isEditing) {
      const objs = canvas.getActiveObjects();
      canvas.discardActiveObject(); canvas.remove(...objs); canvas.requestRenderAll();
    }
    closeSheet();
  });

  // ---- copy text from an image ----
  // The canvas box is CSS-zoomed, so (box width / page width) is the px-per-scene-unit scale. An
  // image's calcTransformMatrix (flips and rotation included) takes its centred local space to
  // scene units; adding half the crop size and the crop offset reaches the element's pixels, and
  // cw/sw, ch/sh the downscaled JPEG the recognizer reads.
  let pressAt = null; // client point of the long-press that opened the sheet
  let mark = null, markTimer;
  function clearMark() { clearTimeout(markTimer); mark?.remove(); mark = null; }
  const boxScale = () => { const r = canvas.lowerCanvasEl.getBoundingClientRect(); return [r, r.width / editor.size[0]]; };
  async function copyText(o, at) {
    clearMark();
    const el = o.getElement(), sw = o.width, sh = o.height;
    if (!el || !sw || !sh) { toast('This image is not ready yet. Wait a moment and try again.'); return; }
    const k = Math.min(1, 2000 / Math.max(sw, sh)), cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    let base64;
    try {
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); // JPEG has no alpha: transparent areas would turn black
      g.drawImage(el, o.cropX || 0, o.cropY || 0, sw, sh, 0, 0, cw, ch);
      base64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    } catch {
      toast('Could not read this image. Add it to the design again.');
      return;
    }
    const [r, z] = boxScale();
    const p = fabric.util.transformPoint(new fabric.Point((at.x - r.left) / z, (at.y - r.top) / z), fabric.util.invertTransform(o.calcTransformMatrix()));
    let x = (p.x + sw / 2) * cw / sw, y = (p.y + sh / 2) * ch / sh;
    if (x < 0 || y < 0 || x > cw || y > ch) x = y = null;
    toast('Reading text…', 15000);
    try {
      const res = await window.native.recognizeText({ base64, x, y });
      if (res.scope !== 'line') { toast('Copied all text'); return; }
      toast(`Copied: ${res.text.slice(0, 40)}${res.text.length > 40 ? '…' : ''}`);
      if (!res.box || !canvas.contains(o)) return;
      // the line's four corners, back through the image's current matrix to page pixels
      const m = o.calcTransformMatrix(), [r2, z2] = boxScale(), [l, t, rt, b] = res.box;
      const xs = [], ys = [];
      for (const [qx, qy] of [[l, t], [rt, t], [rt, b], [l, b]]) {
        const s = fabric.util.transformPoint(new fabric.Point(qx * sw / cw - sw / 2, qy * sh / ch - sh / 2), m);
        xs.push(r2.left + s.x * z2); ys.push(r2.top + s.y * z2);
      }
      mark = document.createElement('div');
      mark.className = 'ocrmark';
      Object.assign(mark.style, { left: Math.min(...xs) + 'px', top: Math.min(...ys) + 'px', width: Math.max(...xs) - Math.min(...xs) + 'px', height: Math.max(...ys) - Math.min(...ys) + 'px' });
      document.body.append(mark);
      markTimer = setTimeout(clearMark, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg.startsWith('No text found') ? `${msg}. Try a sharper picture.` : msg);
    }
  }

  // ---- pinch and pan ----
  const pts = new Map(); // pointerId → { x, y }
  let gest = null; // { mid, dist, z0, z }
  let pan = null; // one finger down on empty space: { x, y, sl, st }
  let press = null; // { x, y, timer }
  const wall = () => { canvas.upperCanvasEl.style.pointerEvents = 'none'; };
  const unwall = () => { canvas.upperCanvasEl.style.pointerEvents = ''; };

  function startGesture() {
    closeSheet();
    pan = null;
    const [a, b] = [...pts.values()];
    gest = {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      z0: canvas.getZoom(),
    };
    gest.z = gest.z0;
    canvas.discardActiveObject();
    canvas._currentTransform = null;
    wall();
  }
  function stepGesture() {
    const [a, b] = [...pts.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    // scale from the zoom at the start (never from the last frame's), keep the page point under
    // the previous midpoint, then follow the midpoint's move, all by scrolling the board
    const box = canvas.wrapperEl;
    const r0 = box.getBoundingClientRect();
    const fx = (gest.mid.x - r0.left) / r0.width, fy = (gest.mid.y - r0.top) / r0.height;
    gest.z = editor.setZoom(gest.z0 * dist / gest.dist, true);
    const r1 = box.getBoundingClientRect();
    board.scrollLeft += r1.left + fx * r1.width - mid.x;
    board.scrollTop += r1.top + fy * r1.height - mid.y;
    gest.mid = mid;
  }
  function endGesture() {
    if (pts.size > 1) return; // a finger went down before the last one lifted
    editor.setZoom(gest.z); // the one sharp redraw
    gest = null;
    if (sheet.hidden) unwall(); // otherwise the release of the wall goes with the sheet's own close
  }

  // ---- long press ----
  function armPress(e) {
    disarmPress();
    press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => openSheet(e), 500) };
  }
  function disarmPress() {
    clearTimeout(press?.timer);
    press = null;
  }
  const hit = e => { const f = canvas.findTarget(e); return f?.target ?? f?.currentTarget; };
  function openSheet(e) {
    press = null;
    if (gest || pts.size > 1) return;
    const target = hit(e);
    if (target) {
      pressAt = { x: e.clientX, y: e.clientY };
      sheet.querySelector('[data-a="ocr"]').hidden = !(window.ReactNativeWebView && target instanceof fabric.FabricImage);
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      canvas._currentTransform = null;
      wall();
      sheet.hidden = false;
    }
  }
  const closeSheet = () => { sheet.hidden = true; if (!gest) unwall(); };

  // ---- pointer plumbing (capture: read the fingers before anything else looks) ----
  board.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearMark(); // any new touch, a pinch included, drops the highlight
    if (sheet.hidden === false) closeSheet();
    disarmPress();
    if (pts.size === 2) startGesture();
    else if (pts.size === 1) {
      armPress(e);
      // in select-several mode a drag on empty space draws a selection box instead of panning
      pan = hit(e) || editor.selectMany ? null : { x: e.clientX, y: e.clientY, sl: board.scrollLeft, st: board.scrollTop };
    }
  }, true);
  board.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (gest) stepGesture();
    else {
      if (press && Math.hypot(p.x - press.x, p.y - press.y) > 12) disarmPress();
      if (pan) { board.scrollLeft = pan.sl - (p.x - pan.x); board.scrollTop = pan.st - (p.y - pan.y); }
    }
  }, true);
  const lift = e => {
    pts.delete(e.pointerId);
    pan = null;
    if (gest) endGesture();
    else if (sheet.hidden) unwall();
    disarmPress();
  };
  board.addEventListener('pointerup', lift, true);
  board.addEventListener('pointercancel', lift, true);
  // while pinching, stop the browser from scrolling the board underneath; touchstart and
  // touchend pass through so Fabric can clean up via its own document-level handlers
  board.addEventListener('touchmove', e => {
    if (gest && e.touches.length >= 2) e.preventDefault();
  }, { capture: true, passive: false });
  board.addEventListener('contextmenu', e => e.preventDefault());
})();
