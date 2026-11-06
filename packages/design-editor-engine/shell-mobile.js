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

  window.native = {
    saveFile: ({ name, ext, data, filePath }) => {
      // binary exports (png/jpg/pdf) cross as base64; json and svg are strings. The page refuses
      // exports over 30 MB (SPEC §14.3), because the bridge stalls around 40 MB.
      let base64 = null, text = null;
      if (data instanceof Uint8Array) {
        if (data.length > 30_000_000) {
          toast('Too large to save on the phone: try 2×');
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
    media: { openWindow() {}, onEvent() {}, async status() { return {}; }, async pick() { return null; }, async pickFolder() { return null; }, async plan() { return null; }, async enqueue() { return []; }, async cancel() {}, async keyframe() { return null; }, async thumbs() { return []; }, async queue() { return []; }, async reveal() { return null; }, async open() { return null; } },
  };

  post({ type: 'ready' });
})();
