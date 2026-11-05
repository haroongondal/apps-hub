// Isolated-world relay: probe-main.js (page world) -> sw.js, and spike.js -> probe-main.js.
// shortcut: any page script can forge these window messages; fine for a throwaway spike.
(() => {
  const pending = new Map(); // run id -> sendResponse of the spike page's "Run all" request
  let chain = Promise.resolve(); // keeps results stored before the run is reported done
  let failure = null;

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== window || m?.source !== 'sieve-spike') return;
    chain = chain.then(async () => {
      if (m.result) await chrome.runtime.sendMessage({ type: 'probe-result', result: m.result });
      if (m.fixture) await chrome.runtime.sendMessage({ type: 'fixture', fixture: m.fixture });
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
