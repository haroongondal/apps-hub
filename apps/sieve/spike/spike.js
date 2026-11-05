const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };

const storedResults = async () =>
  Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('probe:')).sort());

function summarise(r) {
  if (r.error) return { strategy: r.strategy, videoId: r.videoId, error: r.error };
  const counts = { url: 0, cipher: 0, none: 0 };
  const maxHeight = { url: null, cipher: null, none: null };
  for (const f of r.formats) {
    counts[f.has]++;
    if (f.height != null && f.height > (maxHeight[f.has] ?? 0)) maxHeight[f.has] = f.height;
  }
  return { strategy: r.strategy, videoId: r.videoId, signedIn: r.loggedIn, playability: r.playability, sabr: r.sabr, counts, maxHeight };
}

async function render() {
  const results = Object.values(await storedResults());
  const box = $('results');
  box.replaceChildren();
  if (!results.length) { box.textContent = 'No results yet. Click Run all.'; return; }
  for (const r of results) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = `${r.strategy} for ${r.videoId}`;
    const p = document.createElement('p');
    p.textContent = JSON.stringify(summarise(r));
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = 'Full result';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(r, null, 2);
    d.append(s, pre);
    section.append(h, p, d);
    box.append(section);
  }
}

async function runAll() {
  const tabs = (await chrome.tabs.query({ url: '*://www.youtube.com/watch*' })).sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (!tabs.length) throw new Error('No YouTube video tab is open. Open a video, then click Run all again.');
  await chrome.storage.local.remove(Object.keys(await storedResults()));
  const reply = await chrome.tabs.sendMessage(tabs[0].id, { type: 'sieve-run' }).catch(() => {
    throw new Error('The video tab cannot talk to the spike yet. Wait for the video page to finish loading, or reload it, then click Run all again.');
  });
  if (!reply?.ok) throw new Error(`The probe failed: ${reply?.error ?? 'no answer'}. Reload the video tab and try again.`);
}

async function save() {
  const results = await storedResults();
  if (!Object.keys(results).length) throw new Error('There is nothing to save yet. Click Run all first.');
  const label = Object.values(results).some((r) => r.loggedIn) ? 'signed-in' : 'signed-out';
  const body = { label, savedAt: new Date().toISOString(), userAgent: navigator.userAgent, results };
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  await chrome.downloads.download({ url, filename: `sieve-spike-${label}.json`, conflictAction: 'overwrite' });
  return `sieve-spike-${label}.json`;
}

const guard = (busy, fn) => async () => {
  say(busy);
  try { say(await fn()); } catch (err) { say(err.message); }
  await render();
};
$('run').addEventListener('click', guard('Running the probes...', async () => { await runAll(); return 'Done. Results below.'; }));
$('save').addEventListener('click', guard('Saving...', async () => `Saved Downloads/${await save()}`));
chrome.storage.onChanged.addListener(render);
render();
