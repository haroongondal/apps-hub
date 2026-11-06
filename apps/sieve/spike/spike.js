const $ = (id) => document.getElementById(id);
const say = (text) => { $('status').textContent = text; };

const storedResults = async () =>
  Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('probe:')).sort());
// Raw and solved stream URLs live only in session storage (streams:<strategy>), never in what is shown or saved.
const storedStreams = async () => Object.values(await chrome.storage.session.get(null));

function tally(formats) {
  const counts = { url: 0, cipher: 0, none: 0 };
  const maxHeight = { url: null, cipher: null, none: null };
  for (const f of formats) {
    counts[f.has]++;
    if (f.height != null && f.height > (maxHeight[f.has] ?? 0)) maxHeight[f.has] = f.height;
  }
  return { counts, maxHeight };
}

function summarise(r) {
  if (r.error) return { strategy: r.strategy, videoId: r.videoId, signedIn: r.loggedIn, error: r.error };
  if (r.strategy === 'S3') {
    return {
      strategy: 'S3', videoId: r.videoId, signedIn: r.loggedIn, ejs: r.ejs, scanned: r.scanned, nothingToSolve: r.nothingToSolve,
      players: r.players.map((p) => ({ jscMs: p.jscMs, sigSolved: p.sigSolved, nSolved: p.nSolved, errors: p.errors, error: p.error })),
      classes: Object.fromEntries(Object.entries(r.classes).map(([k, c]) => {
        const outcomes = {};
        for (const x of c.checks) { const o = `${x.status} (unsolved ${x.unsolved})`; outcomes[o] = (outcomes[o] ?? 0) + 1; }
        return [k, { formats: c.formats, solved: c.solved, checked: c.checked, passed: c.passed, outcomes, pass: c.pass }];
      })),
    };
  }
  return {
    strategy: r.strategy, videoId: r.videoId, signedIn: r.loggedIn, playability: r.playability, sabr: r.sabr,
    ...tally(r.formats), muxed: tally(r.muxed ?? []),
    audioUrl: r.formats.some((f) => f.has === 'url' && f.mimeType?.startsWith('audio/')),
  };
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

const EJS = '0.8.0';
const solverFrame = $('solver');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let solveSeq = 0;

// solve(playerJsText, { sig, n }) => { sig: {challenge: solution}, n: {...}, errors: { sig?, n? }, ms }
function solve(player, { sig, n }) {
  const id = ++solveSeq;
  return new Promise((resolve, reject) => {
    const done = (fn, v) => { clearTimeout(timer); removeEventListener('message', on); fn(v); };
    const on = (e) => {
      if (e.source !== solverFrame.contentWindow || e.data?.id !== id) return;
      if (e.data.error) done(reject, new Error(`solver: ${e.data.error}`));
      else done(resolve, e.data);
    };
    const timer = setTimeout(() => done(reject, new Error('the solver page did not answer within 90 s')), 90_000);
    addEventListener('message', on);
    // '*': the sandboxed solver page has an opaque origin, so there is none to name; both ends check event.source.
    solverFrame.contentWindow.postMessage({ id, player, sig, n }, '*');
  });
}

function targets(rec) {
  return rec.formats.flatMap((f) => {
    const c = f.signatureCipher ? new URLSearchParams(f.signatureCipher) : null;
    const url = c ? c.get('url') : f.url;
    const n = url ? new URL(url).searchParams.get('n') : null;
    if (!url || (!c && !n)) return [];
    const classes = n ? ['any n'] : [];
    if (c) classes.push(rec.strategy === 'S1' ? `S1 ${f.muxed ? 'muxed' : 'adaptive'} cipher` : rec.strategy.startsWith('S2:tv') ? 'tv-family cipher' : `${rec.strategy} cipher`);
    return [{ ...f, strategy: rec.strategy, playerJsUrl: rec.playerJsUrl, url, s: c?.get('s') ?? null, sp: c?.get('sp') || 'signature', n, classes }];
  });
}

function finalUrl(t, sol) {
  if ((t.n && !sol.n[t.n]) || (t.s && !sol.sig[t.s])) return null;
  let url = t.n ? t.url.replace(/([?&]n=)[^&]*/, `$1${encodeURIComponent(sol.n[t.n])}`) : t.url;
  if (t.s) url += `&${t.sp}=${encodeURIComponent(sol.sig[t.s])}`;
  return url;
}

async function eachLimited(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

async function rangeCheck(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' }, credentials: 'omit', signal: AbortSignal.timeout(20_000) });
      if (res.status !== 206) {
        res.body?.cancel().catch(() => {});
        return { status: res.status, attempt };
      }
      return { status: 206, bytes: (await res.arrayBuffer()).byteLength, attempt };
    } catch (err) {
      if (attempt === 2) return { status: 'network', error: err?.name === 'TimeoutError' ? 'timed out' : String(err?.message ?? err), attempt };
      await pause(3_000);
    }
  }
}

async function S3(videoId, loggedIn) {
  const recs = await storedStreams();
  const all = recs.flatMap(targets);
  const blank = () => ({ formats: 0, solved: 0, checked: 0, passed: 0, checks: [], pass: null });
  const scanned = Object.fromEntries(recs.map((r) => [r.strategy, r.formats.length]));
  const result = { strategy: 'S3', videoId, loggedIn, ejs: EJS, scanned, nothingToSolve: !all.length, players: [], classes: { 'S1 muxed cipher': blank(), 'tv-family cipher': blank(), 'any n': blank() } };
  for (const t of all) for (const c of t.classes) (result.classes[c] ??= blank()).formats++;

  for (const playerJsUrl of new Set(all.map((t) => t.playerJsUrl))) {
    const group = all.filter((t) => t.playerJsUrl === playerJsUrl);
    const info = { playerJsUrl, formats: group.length };
    result.players.push(info);
    try {
      if (!playerJsUrl) throw new Error('the probe recorded no player script URL');
      const getPlayer = () => fetch(new URL(playerJsUrl, 'https://www.youtube.com'), { signal: AbortSignal.timeout(20_000) });
      const res = await getPlayer().catch(() => pause(3_000).then(getPlayer));
      if (!res.ok) throw new Error(`player script: HTTP ${res.status}`);
      const sol = await solve(await res.text(), {
        sig: [...new Set(group.map((t) => t.s).filter(Boolean))],
        n: [...new Set(group.map((t) => t.n).filter(Boolean))],
      });
      Object.assign(info, { jscMs: sol.ms, sigSolved: Object.keys(sol.sig).length, nSolved: Object.keys(sol.n).length, errors: sol.errors });
      for (const t of group) {
        t.final = finalUrl(t, sol);
        if (t.final) for (const c of t.classes) result.classes[c].solved++;
      }
    } catch (err) {
      info.error = err?.name === 'TimeoutError' ? 'player script: timed out' : String(err?.message ?? err);
    }
  }

  await eachLimited(all.filter((t) => t.final), 4, async (t) => {
    // Control: the same URL with the raw challenges, to show that the solving is what makes it answer.
    const [solvedCheck, control] = await Promise.all([rangeCheck(t.final), rangeCheck(t.s ? `${t.url}&${t.sp}=${encodeURIComponent(t.s)}` : t.url)]);
    const check = { strategy: t.strategy, itag: t.itag, height: t.height, mimeType: t.mimeType, ...solvedCheck, unsolved: control.status };
    t.check = check.status;
    for (const c of t.classes) {
      const cls = result.classes[c];
      cls.checks.push(check);
      cls.checked++;
      if (check.status === 206) cls.passed++;
    }
  });
  for (const c of Object.values(result.classes)) c.pass = c.formats ? c.passed === c.formats : null;
  const solved = all.filter((t) => t.final).map(({ strategy, itag, mimeType, height, muxed, final, check }) => ({ strategy, itag, mimeType, height, muxed, url: final, check }));
  await chrome.storage.session.set({ 'streams:S3': { strategy: 'S3', videoId, formats: solved } });
  await chrome.storage.local.set({ 'probe:S3': result });
}

async function runAll() {
  const tabs = (await chrome.tabs.query({ url: '*://www.youtube.com/watch*' })).sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (!tabs.length) throw new Error('No YouTube video tab is open. Open a video, then click Run all again.');
  await chrome.storage.local.remove(Object.keys(await storedResults()));
  await chrome.storage.session.clear();
  const reply = await chrome.tabs.sendMessage(tabs[0].id, { type: 'sieve-run' }).catch(() => {
    throw new Error('The video tab cannot talk to the spike yet. Wait for the video page to finish loading, or reload it, then click Run all again.');
  });
  if (!reply?.ok) throw new Error(`The probe failed: ${reply?.error ?? 'no answer'}. Reload the video tab and try again.`);
  const probes = Object.values(await storedResults());
  const videoId = probes.find((r) => r.videoId)?.videoId ?? null;
  const loggedIn = probes.map((r) => r.loggedIn).find((v) => typeof v === 'boolean') ?? null;
  try { await S3(videoId, loggedIn); }
  catch (err) { await chrome.storage.local.set({ 'probe:S3': { strategy: 'S3', videoId, loggedIn, ejs: EJS, error: String(err?.message ?? err) } }); }
}

async function save() {
  const results = await storedResults();
  const list = Object.values(results);
  if (!list.length) throw new Error('There is nothing to save yet. Click Run all first.');
  if (list.every((r) => r.error)) throw new Error('Every probe failed, so there is nothing worth saving. Reload the video tab and click Run all again.');
  const signedIn = list.map((r) => r.loggedIn).find((v) => typeof v === 'boolean');
  if (signedIn === undefined) throw new Error('The video page did not say whether you are signed in. Reload the video tab and click Run all again.');
  const label = signedIn ? 'signed-in' : 'signed-out';
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
