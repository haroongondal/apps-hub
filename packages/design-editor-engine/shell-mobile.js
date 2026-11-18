'use strict';
// The mobile shell: window.native with the same functions as preload.cjs, over the RN WebView
// bridge instead of Electron IPC (SPEC §14.3). Requests carry a reqId; the app answers every
// one with window.__editorCommand('reply', { reqId, ok, value? }). The schema lives in
// apps/design-editor-mobile/src/editor/bridge.ts; keep the two in step.
// Script order note: this runs before app.js because app.js calls native.onMenu() during its
// own body — the desktop's preload guarantees native exists for that too.
(() => {
  // body (not documentElement): every embedded rule in mobile.html reads body.embedded,
  // and touch.js toggles its sibling .obj class on body too; scripts run after <body> opens
  document.body.classList.toggle('embedded', !!window.ReactNativeWebView);

  // Fonts: the built page ships alone, so vendor/*.ttf and ../ui/fonts/*.ttf are not on disk.
  // build.mjs publishes window.__fontsData (vendor path → data: URL) and the shims below route
  // app.js's FontFace construction and fontkit's fetch through it. When the page is opened
  // directly (file://, Chrome smoke test) the real files are there and stay untouched.
  const fonts = window.__fontsData || {};
  const RealFontFace = window.FontFace;
  window.FontFace = function (family, source, descriptors) {
    const m = /^url\("(.+?\.ttf)"\)$/.exec(source);
    return new RealFontFace(family, m && fonts[m[1]] ? `url("${fonts[m[1]]}")` : source, descriptors);
  };
  const rawFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    return url && fonts[url] ? rawFetch(fonts[url], init) : rawFetch(input, init);
  };

  // ---- the bridge ----
  const waiting = new Map(); // reqId → { resolve }
  const backlog = []; // events posted before any bridge exists ("device" Chrome tests inject late)
  let seq = 0;
  let menuHandler = null;
  const menuBacklog = [];
  let visionRun = null; // the one vision run in flight: { id, stopped, onProgress, stop }

  const post = msg => {
    const rn = window.ReactNativeWebView;
    if (!rn) return backlog.push(msg);
    // drain anything the page said before the bridge showed, so order survives
    while (backlog.length) rn.postMessage(backlog.shift());
    rn.postMessage(JSON.stringify(msg));
  };
  const call = (type, extra = {}) => new Promise((resolve, reject) => {
    const reqId = String(++seq);
    waiting.set(reqId, { resolve, reject });
    post({ type, reqId, ...extra });
  });

  // same element app.js's toast uses; the shell needs it before app.js runs (refused exports)
  let toastTimer;
  function toast(msg, ms = 1800) {
    const t = document.querySelector('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  window.__editorCommand = (type, p = {}) => {
    if (type === 'reply') {
      const w = waiting.get(String(p.reqId));
      if (!w) return;
      waiting.delete(String(p.reqId));
      if (p.ok) w.resolve(p.value);
      else w.reject(new Error(p.error ?? 'rejected'));
    } else if (type === 'menu') {
      menuHandler ? menuHandler(p.cmd) : menuBacklog.push(p.cmd);
    } else if (type === 'toast') {
      toast(p.message, 5000);
    } else if (type === 'visionProgress') {
      const r = visionRun;
      if (r && r.id === p.id && !r.stopped && r.onProgress) r.onProgress(p.phase, p.fraction);
    }
  };

  // window.confirm through the bridge: discardOk() in app.js awaits it (desktop stays sync there)
  const desktopConfirm = window.confirm.bind(window);
  window.confirm = message =>
    window.ReactNativeWebView ? call('confirm', { message }) : Promise.resolve(desktopConfirm(message));

  const b64 = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  };

  // Vision (SPEC §14.3, as built 2026-11-18): the image goes to the app in pieces of 786,432
  // bytes (1,048,576 base64 chars, a multiple of 3 so they join), the PNG comes back the same way.
  const PIECE = 786432;
  const fromB64 = s => {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  async function visionSteps(r, op, option, image) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const chunks = Math.max(1, Math.ceil(bytes.length / PIECE));
    for (let index = 0; index < chunks; index++) {
      if (r.stopped) return null;
      await call('visionChunk', { id: r.id, index, data: b64(bytes.subarray(index * PIECE, (index + 1) * PIECE)) });
    }
    if (r.stopped) return null;
    const res = await call('vision', { id: r.id, op, option, chunks });
    const parts = [];
    let got = 0;
    for (let index = 0; res && !r.stopped; index++) {
      const { data, done } = await call('visionRead', { id: r.id, index });
      parts.push(fromB64(data));
      got += parts[index].length;
      if (!done) continue;
      if (got !== res.bytes) throw new Error("The changed image wasn't saved. Try again.");
      return new Blob(parts, { type: 'image/png' });
    }
    return null;
  }
  function vision(req = {}) {
    if (req.op === 'tools') return call('visionTools');
    if (req.op === 'cancel') {
      const r = visionRun;
      if (!r || r.stopped) return Promise.resolve();
      r.stop();
      return call('visionCancel', { id: r.id }).then(() => {}, () => {});
    }
    if (visionRun) return Promise.reject(new Error('Wait for the current change to finish.'));
    if ((req.op !== 'cutout' && req.op !== 'upscale') || !(req.image instanceof Blob)) {
      return Promise.reject(new Error("This change didn't start properly. Try again."));
    }
    let stop;
    const stopped = new Promise(res => { stop = () => res(null); });
    const r = {
      id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      stopped: false,
      onProgress: req.onProgress,
      stop: () => { r.stopped = true; stop(); },
    };
    visionRun = r;
    // the run stays busy until the app has answered, even after a cancel resolved the page's promise
    const work = visionSteps(r, req.op, req.op === 'cutout' ? req.kind : String(req.scale), req.image)
      .catch(err => {
        if (r.stopped) return null;
        call('visionCancel', { id: r.id }).catch(() => {}); // the app drops whatever it still holds
        throw err;
      })
      .finally(() => { if (visionRun === r) visionRun = null; });
    return Promise.race([work, stopped]);
  }

  // Uploads on the phone. The WebView's own file chooser adds a camera entry to an image input,
  // so the label asks the app to pick (gallery and files only), pulls each photo over in pieces
  // like vision does, and hands them to #imgFile's change event so app.js's readFiles runs as is.
  const drop = document.querySelector('#drop');
  let picking = false;
  if (drop && window.ReactNativeWebView) drop.addEventListener('click', async e => {
    e.preventDefault();
    if (picking) return;
    picking = true;
    let given = [];
    try {
      given = await call('pickImages');
      if (!given.length) return; // backed out: nothing to say
      const files = [];
      for (const g of given) {
        const parts = [];
        let got = 0;
        for (let index = 0; ; index++) {
          const { data, done } = await call('readImage', { uri: g.uri, index });
          parts.push(fromB64(data));
          got += parts[index].length;
          if (done) break;
        }
        if (got !== g.bytes) throw new Error('short read'); // a cut photo must not be added
        files.push(new File(parts, g.name, { type: g.type || 'image/jpeg' }));
      }
      const input = drop.querySelector('input');
      const list = new DataTransfer();
      files.forEach(f => list.items.add(f));
      input.files = list.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      toast("Couldn't open your pictures. Try again.");
    } finally {
      picking = false;
      if (given.length) call('releaseImages', { uris: given.map(g => g.uri) }).catch(() => {});
    }
  });

  window.native = {
    saveFile: ({ name, ext, data, filePath }) => {
      // binary exports (png/jpg/pdf) cross as base64; json and svg are strings. The page refuses
      // exports over 30 MB (SPEC §14.3), because the bridge stalls around 40 MB.
      let base64 = null, text = null;
      if (data instanceof Uint8Array) {
        if (data.length > 30_000_000) {
          toast('This image is too big to save. Choose a smaller size.');
          return Promise.resolve(null);
        }
        base64 = b64(data);
      } else {
        text = String(data);
      }
      return call('saveFile', { name, ext, base64, text, filePath: filePath ?? null });
    },
    openDesign: () => call('openDesign'),
    readAutosave: () => call('readAutosave'),
    writeAutosave: saved => call('writeAutosave', { text: JSON.stringify(saved) }),
    // documented addition, 2026-11-03: app.js calls keepAutosave; the desktop meets it in
    // preload.cjs, so the mobile schema gains an event too (SPEC §14.3 as built)
    keepAutosave: () => call('keepAutosave'),
    setDocState: ({ title, dirty, filePath }) => post({ type: 'docState', title, dirty, filePath: filePath ?? null }),
    onMenu: fn => {
      menuHandler = fn;
      while (menuBacklog.length) fn(menuBacklog.shift());
    },
    // the Media tools window is the Mac's; the rail button is hidden on phones (mobile.html).
    // The stubs stand in so a stray media call can never crash the page.
    vision,
    media: { openWindow() {}, onEvent() {}, async status() { return {}; }, async pick() { return null; }, async pickFolder() { return null; }, async plan() { return null; }, async enqueue() { return []; }, async cancel() {}, async keyframe() { return null; }, async thumbs() { return []; }, async queue() { return []; }, async reveal() { return null; }, async open() { return null; } },
  };

  post({ type: 'ready' });
})();
