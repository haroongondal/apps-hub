// Solves in a worker: ejs's node setup assigns globalThis.location, which navigates a page away but not a worker (README.md).
function workerMain(urls) {
  importScripts(urls.lib);
  Object.assign(globalThis, lib);
  importScripts(urls.core);
  const reason = (e) => String(e).split('\n')[0].replace(/^(invalid solutions):.*/, '$1').slice(0, 160);
  onmessage = ({ data: { player, sig, n } }) => {
    const t = performance.now();
    let out;
    try {
      out = jsc({ type: 'player', player, output_preprocessed: false, requests: [{ type: 'sig', challenges: sig }, { type: 'n', challenges: n }] });
    } catch (err) {
      postMessage({ error: reason(err?.message ?? err) });
      return;
    }
    const res = { sig: {}, n: {}, errors: {}, ms: Math.round(performance.now() - t) };
    ['sig', 'n'].forEach((type, i) => {
      const r = out.responses?.[i];
      if (r?.type === 'result') res[type] = r.data;
      else res.errors[type] = reason(r?.error ?? out.error ?? 'no answer');
    });
    postMessage(res);
  };
}

const urls = { lib: new URL('vendor/yt.solver.lib.js', location.href).href, core: new URL('vendor/yt.solver.core.js', location.href).href };
const workerUrl = URL.createObjectURL(new Blob([`(${workerMain})(${JSON.stringify(urls)})`], { type: 'text/javascript' }));

window.addEventListener('message', (e) => {
  if (e.source !== parent || typeof e.data?.player !== 'string') return;
  const { id, player, sig = [], n = [] } = e.data;
  const worker = new Worker(workerUrl);
  const finish = (out) => {
    clearTimeout(timer);
    worker.terminate();
    // '*': this sandboxed page has an opaque origin and cannot name its parent's; spike.js checks event.source.
    parent.postMessage({ id, ...out }, '*');
  };
  const timer = setTimeout(() => finish({ error: 'the solver took longer than 60 s' }), 60_000);
  worker.onmessage = (m) => finish(m.data);
  worker.onerror = (ev) => { ev.preventDefault(); finish({ error: `the solver worker failed: ${ev.message}` }); };
  worker.postMessage({ player, sig, n });
});
