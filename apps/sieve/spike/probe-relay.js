// Isolated-world relay: probe-main.js (page world) -> sw.js, and spike.js -> probe-main.js.
// shortcut: any page script can forge these window messages; fine for a throwaway spike.
(() => {
  const pending = new Map(); // run id -> sendResponse of the spike page's "Run all" request
  let chain = Promise.resolve(); // keeps results stored before the run is reported done
  let failure = null;

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || m?.source !== 'sieve-spike') return;
    const send = async (msg) => {
      const r = await chrome.runtime.sendMessage(msg);
      if (r?.error) throw new Error(`the service worker could not store ${msg.type}: ${r.error}`);
    };
    chain = chain.then(async () => {
      if (m.result) await send({ type: 'probe-result', result: m.result });
      if (m.fixture) await send({ type: 'fixture', fixture: m.fixture });
      if (m.streams) await send({ type: 'streams', streams: m.streams });
    }).catch((err) => { failure = String(err); }).then(() => {
      if (m.done) pending.get(m.done)?.({ ok: !failure, error: failure });
    });
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'sieve-run') return;
    const id = crypto.randomUUID();
    failure = null;
    pending.set(id, reply);
    window.postMessage({ source: 'sieve-spike-cmd', id }, location.origin);
    return true;
  });
})();
