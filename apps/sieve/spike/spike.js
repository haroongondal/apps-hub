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
  if (r.strategy === 'DL') {
    return {
      strategy: 'DL', videoId: r.videoId, signedIn: r.loggedIn, error: r.error, baseline: r.baseline, split: r.split,
      streams: (r.streams ?? []).map(({ role, mode, itag, height, bytes, contentLength, ms, waitedMs, mbps, xBitrate, q1, q2, pass, reason }) => ({ role, mode, itag, height, bytes, contentLength, ms, waitedMs, mbps, xBitrate, q1, q2, pass, reason })),
    };
  }
  if (r.strategy === 'Q4') return r; // numbers and the public test URLs only
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
    h.textContent = r.videoId ? `${r.strategy} for ${r.videoId}` : r.strategy;
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
      // The body read is inside the retried call, so a read that fails halfway retries the whole fetch too.
      const getPlayer = async () => {
        const res = await fetch(new URL(playerJsUrl, 'https://www.youtube.com'), { signal: AbortSignal.timeout(20_000) });
        return { status: res.status, text: res.ok ? await res.text() : null };
      };
      const res = await getPlayer().catch(() => pause(3_000).then(getPlayer));
      if (res.text === null) throw new Error(`player script: HTTP ${res.status}`);
      const sol = await solve(res.text, {
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

const MIB = 1024 * 1024;
let received = 0;
const mb = (n) => Math.round(n / 1e6);
const round2 = (x) => Math.round(x * 100) / 100;
const BASELINES = ['https://speed.cloudflare.com/__down?bytes=25000000', 'http://proof.ovh.net/files/10Mb.dat'];

// discard: count the bytes and drop them (no body in the result). timeoutMs covers the whole request, body included.
async function fetchRange(url, start, length, { discard = false, timeoutMs = 60_000, retryTimeouts = true } = {}) {
  const tStart = performance.now();
  const errors = [];
  for (let attempt = 1; ; attempt++) {
    const t0 = performance.now();
    const waitedMs = Math.round(t0 - tStart);
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (res.status !== 206) {
        res.body?.cancel().catch(() => {});
        return { status: res.status, attempt, ms: Math.round(performance.now() - t0), waitedMs, errors };
      }
      const total = Number(/\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1]) || null;
      let body;
      let bytes = 0;
      if (discard) for await (const part of res.body) { bytes += part.byteLength; received += part.byteLength; }
      else bytes = (body = await res.arrayBuffer()).byteLength;
      return { status: 206, body, bytes, total, attempt, ms: Math.round(performance.now() - t0), waitedMs, errors };
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      const error = timedOut ? `timed out after ${timeoutMs / 1000} s` : String(err?.message ?? err);
      errors.push(error);
      if (attempt === 2 || (timedOut && !retryTimeouts)) return { status: 'network', error, attempt, ms: 0, waitedMs: Math.round(performance.now() - tStart), errors };
      await pause(3_000);
    }
  }
}

// yt-dlp's chunk size: googlevideo throttles single long requests. Only the count, Content-Range total and first 16 bytes are kept.
// ms and mbps (MB of 1e6 bytes per second) count the successful attempts only; a failed attempt and its pause go to waitedMs.
async function downloadStream(url, contentLength, { maxBytes = contentLength, onProgress } = {}) {
  const goal = Math.min(contentLength, maxBytes);
  const out = { bytes: 0, ms: 0, mbps: 0, magic: null, contentRangeTotal: null, retries: 0, waitedMs: 0, retryErrors: [], chunkMs: [] };
  onProgress?.(0);
  while (out.bytes < goal) {
    const length = Math.min(10 * MIB, goal - out.bytes);
    const r = await fetchRange(url, out.bytes, length);
    out.retries += r.attempt - 1;
    out.waitedMs += r.waitedMs;
    out.retryErrors.push(...r.errors.map((e) => `offset ${out.bytes}: ${e}`));
    if (r.status !== 206) { out.error = r.status === 'network' ? `network error at offset ${out.bytes}: ${r.error}` : `HTTP ${r.status} at offset ${out.bytes}`; break; }
    out.magic ??= [...new Uint8Array(r.body.slice(0, 16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    out.contentRangeTotal ??= r.total;
    out.ms += r.ms;
    out.chunkMs.push(r.ms);
    out.bytes += r.body.byteLength;
    if (r.body.byteLength !== length) { out.error = `short chunk at offset ${out.bytes - r.body.byteLength}: got ${r.body.byteLength} of ${length} bytes`; break; }
    onProgress?.(out.bytes);
  }
  out.mbps = out.ms ? round2(out.bytes / 1e6 / (out.ms / 1000)) : 0;
  return out;
}

// A neutral host, so a slow link is not read as YouTube throttling. One plain request: a measurement, not an extension feature.
async function baseline() {
  const failed = [];
  for (const url of BASELINES) {
    const host = new URL(url).host;
    const t0 = performance.now();
    try {
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = 0;
      for await (const part of res.body) bytes += part.byteLength;
      const ms = Math.round(performance.now() - t0);
      return { host, bytes, ms, mbps: round2(bytes / 1e6 / (ms / 1000)), failed };
    } catch (err) {
      failed.push(`${host}: ${err?.name === 'TimeoutError' ? 'timed out' : String(err?.message ?? err)}`);
    }
  }
  return { error: 'neither neutral host answered', failed };
}

// A raw URL that still carries an `n` is refused or throttled, so only S3's solved copy of it counts.
async function candidates() {
  const probes = await storedResults();
  return (await storedStreams()).flatMap((rec) => rec.formats.flatMap((f) => {
    const source = f.strategy ?? rec.strategy;
    const meta = probes[`probe:${source}`]?.formats?.find((m) => m.itag === f.itag);
    if (f.muxed || !f.url || !meta?.contentLength || !meta.bitrate) return [];
    if (rec.strategy !== 'S3' && new URL(f.url).searchParams.has('n')) return [];
    return [{ source, itag: f.itag, height: f.height, mimeType: f.mimeType, bitrate: meta.bitrate, contentLength: meta.contentLength, url: f.url }];
  }));
}

async function working(list) {
  for (const c of list) if ((await rangeCheck(c.url)).status === 206) return c;
  return null;
}

// Q1: every byte arrived and the container magic is right (not claimed for a partial). Q2: at least 5x the stream's bitrate.
async function measure(role, label, c, partial) {
  const goal = partial ? 100 * MIB : c.contentLength;
  const d = await downloadStream(c.url, c.contentLength, { maxBytes: goal, onProgress: (n) => say(`Downloading ${label}: ${mb(n)} of ${mb(Math.min(goal, c.contentLength))} MB`) });
  const rec = { role, mode: partial ? 'partial' : 'full', source: c.source, itag: c.itag, height: c.height, mimeType: c.mimeType, bitrate: c.bitrate, contentLength: c.contentLength, ...d };
  rec.xBitrate = d.ms ? round2((d.bytes * 8) / (d.ms / 1000) / c.bitrate) : 0;
  rec.magicOk = !!(d.magic && (d.magic.slice(8, 16) === '66747970' || d.magic.startsWith('1a45dfa3')));
  const problems = [];
  if (d.error) problems.push(d.error);
  else if (!rec.magicOk) problems.push(`unexpected first bytes ${d.magic}`);
  if (d.contentRangeTotal != null && d.contentRangeTotal !== c.contentLength) problems.push(`Content-Range total ${d.contentRangeTotal} differs from the declared contentLength ${c.contentLength}`);
  if (partial && !d.error) {
    const len = Math.min(MIB, c.contentLength);
    const t = await fetchRange(c.url, c.contentLength - len, len);
    rec.tail = { status: t.status, bytes: t.body?.byteLength ?? 0, total: t.total ?? null };
    if (t.status !== 206 || rec.tail.bytes !== len) problems.push(`the last ${len} bytes: ${t.status === 206 ? `got ${rec.tail.bytes}` : (t.error ?? `HTTP ${t.status}`)}`);
  }
  rec.q1 = partial ? null : problems.length === 0;
  rec.q2 = d.error ? null : rec.xBitrate >= 5;
  if (rec.q2 === false) problems.push(`${rec.xBitrate}x the bitrate is under 5x`);
  rec.pass = problems.length === 0;
  rec.reason = problems.join('; ') || null;
  return rec;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? round2(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const protocols = async (url) => {
  await pause(300);
  return [...new Set(performance.getEntriesByName(new URL(url).href).map((e) => e.nextHopProtocol).filter(Boolean))].join(',') || 'unknown';
};

const RUN_LIMIT_MS = 600_000;

async function timed(label, fn) {
  received = 0;
  const text = () => `${label}: ${round2(received / 1e6)} MB`;
  const tick = setInterval(() => say(text()), 5_000);
  say(text());
  try { return await fn(); } finally { clearInterval(tick); }
}

// A retried part cannot be timed fairly (its stall and the rest running alone both skew the wall time), so the medians skip runs with retries.
async function splitDownload(url, size, parts = 6) {
  const step = Math.ceil(size / parts);
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: parts }, (_, i) => fetchRange(url, i * step, Math.min(step, size - i * step), { discard: true, timeoutMs: RUN_LIMIT_MS, retryTimeouts: false })));
  const ms = Math.round(performance.now() - t0);
  const bytes = rs.reduce((n, r) => n + (r.bytes ?? 0), 0);
  const bad = rs.find((r) => r.status !== 206);
  const out = { bytes, ms, mbps: round2(bytes / 1e6 / (ms / 1000)), retries: rs.reduce((n, r) => n + r.attempt - 1, 0), retryErrors: rs.flatMap((r) => r.errors) };
  if (bad) out.error = bad.status === 'network' ? `a part failed: ${bad.error}` : `a part got HTTP ${bad.status} instead of 206`;
  else if (bytes !== size) out.error = `got ${bytes} of ${size} bytes`;
  if (out.error) out.mbps = 0;
  return out;
}

async function plainDownload(url, size) {
  const t0 = performance.now();
  const ended = {};
  let mine;
  let finish;
  const on = (d) => {
    const state = d.state?.current;
    if (state !== 'complete' && state !== 'interrupted') return;
    const at = { state, ms: Math.round(performance.now() - t0) };
    if (d.id === mine) finish(at); else ended[d.id] = at;
  };
  chrome.downloads.onChanged.addListener(on);
  const poll = setInterval(async () => { const [d] = mine === undefined ? [] : await chrome.downloads.search({ id: mine }); if (d) received = d.bytesReceived; }, 2_000);
  try {
    mine = await chrome.downloads.download({ url });
    const at = ended[mine] ?? await new Promise((resolve) => {
      finish = resolve;
      setTimeout(() => resolve({ state: 'timeout', ms: Math.round(performance.now() - t0) }), RUN_LIMIT_MS);
    });
    const [item] = await chrome.downloads.search({ id: mine });
    const out = { bytes: item?.fileSize ?? 0, ms: at.ms, mbps: 0 };
    if (at.state !== 'complete') out.error = at.state === 'timeout' ? `still running after ${RUN_LIMIT_MS / 60_000} min` : `interrupted: ${item?.error}`;
    else if (out.bytes !== size) out.error = `got ${out.bytes} of ${size} bytes`;
    else out.mbps = round2(out.bytes / 1e6 / (out.ms / 1000));
    if (at.state === 'timeout') await chrome.downloads.cancel(mine);
    if (at.state === 'complete') try { await chrome.downloads.removeFile(mine); } catch (err) { out.cleanup = `removeFile failed: ${String(err?.message ?? err)}`; }
    await chrome.downloads.erase({ id: mine });
    return out;
  } finally { clearInterval(poll); chrome.downloads.onChanged.removeListener(on); }
}

const SPEED_SERVERS = [
  { protocol: 'http/1.1', urls: ['http://proof.ovh.net/files/100Mb.dat', 'https://ash-speed.hetzner.com/100MB.bin', 'http://ping.online.net/100Mo.dat'] },
  { protocol: 'h2', urls: ['https://proof.ovh.net/files/100Mb.dat', 'https://ash-speed.hetzner.com/100MB.bin'] },
  { protocol: 'h2', urls: ['https://cdn.kernel.org/pub/linux/kernel/v5.x/linux-5.10.tar.xz'] },
];

async function pickServer({ protocol, urls }) {
  const checks = [];
  for (const url of urls) {
    performance.clearResourceTimings();
    const r = await fetchRange(url, 0, 1, { discard: true, timeoutMs: 20_000 });
    const seen = await protocols(url);
    checks.push({ url, status: r.status, protocol: seen, error: r.error });
    if (r.status === 206 && seen === protocol && r.total) return { url, size: r.total, checks };
  }
  return { checks };
}

async function speedTest() {
  const result = { strategy: 'Q4', servers: [] };
  const save = () => chrome.storage.local.set({ 'probe:Q4': result });
  try {
    for (const wanted of SPEED_SERVERS) {
      const s = { wanted: wanted.protocol, ...(await pickServer(wanted)), runs: [] };
      result.servers.push(s);
      await save();
      if (!s.url) { s.error = `no candidate answered 206 on ${wanted.protocol}`; continue; }
      for (let run = 1; run <= 3; run++) {
        for (const method of ['plain', 'split']) {
          performance.clearResourceTimings();
          const r = await timed(`${wanted.protocol} ${method}, run ${run} of 3`, () => (method === 'plain' ? plainDownload(s.url, s.size) : splitDownload(s.url, s.size)));
          s.runs.push({ run, method, ...r, ...(method === 'split' ? { protocol: await protocols(s.url) } : {}) });
          await save();
        }
      }
      for (const m of ['plain', 'split']) s[`${m}Mbps`] = median(s.runs.filter((r) => r.method === m && !r.error && !r.retries).map((r) => r.mbps));
      s.ratio = s.plainMbps && s.splitMbps ? round2(s.splitMbps / s.plainMbps) : null;
      await save();
    }
  } catch (err) { result.error = String(err?.message ?? err); await save(); }
}

// R10: a per-request cap lets parallel win, a per-client or per-IP cap does not. Numbers only; the URL stays in session storage.
async function splitProbe(c) {
  const size = Math.min(60 * MIB, c.contentLength);
  const out = { itag: c.itag, height: c.height, bytes: size, runs: [] };
  for (let run = 1; run <= 2; run++) {
    for (const mode of ['sequential', 'parallel']) {
      performance.clearResourceTimings();
      const r = await timed(`googlevideo ${mode}, run ${run} of 2`, () => (mode === 'sequential' ? downloadStream(c.url, c.contentLength, { maxBytes: size, onProgress: (n) => { received = n; } }) : splitDownload(c.url, size)));
      out.runs.push({ run, mode, bytes: r.bytes, ms: r.ms, mbps: r.mbps, retries: r.retries, retryErrors: r.retryErrors, protocol: await protocols(c.url), error: r.error ?? null });
    }
  }
  out.protocol = [...new Set(out.runs.map((r) => r.protocol))].join(',');
  for (const m of ['sequential', 'parallel']) out[`${m}Mbps`] = median(out.runs.filter((r) => r.mode === m && !r.error && r.bytes === size && !r.retries).map((r) => r.mbps));
  out.ratio = out.sequentialMbps && out.parallelMbps ? round2(out.parallelMbps / out.sequentialMbps) : null;
  out.pass = out.runs.every((r) => !r.error && r.bytes === size);
  return out;
}

async function DL(videoId, loggedIn) {
  const result = { strategy: 'DL', videoId, loggedIn, baseline: null, streams: [] };
  const save = () => chrome.storage.local.set({ 'probe:DL': result });
  try { await downloads(result, save); }
  catch (err) { result.error = String(err?.message ?? err); await save(); }
}

async function downloads(result, save) {
  const all = await candidates();
  const video = all.filter((c) => c.height && c.mimeType?.startsWith('video/')).sort((a, b) => b.bitrate - a.bitrate);
  const heights = [...new Set(video.map((c) => c.height))].sort((a, b) => a - b);
  const firstWorking = async (hs) => {
    for (const h of hs) { const c = await working(video.filter((v) => v.height === h)); if (c) return c; }
    return null;
  };
  const full = await firstWorking(heights.filter((h) => h >= 1080));
  if (!full) {
    result.error = 'No video stream of 1080p or more has a plain URL that answers. See the S1, S2 and S3 results for why.';
    await save();
    return;
  }
  const top = await firstWorking(heights.filter((h) => h > full.height).reverse());
  const audio = (await working(all.filter((c) => c.itag === 251))) ?? (await working(all.filter((c) => c.itag === 140)));
  $('status').dataset.expectBytes = String(25e6 + full.contentLength + (audio?.contentLength ?? 0) + (top ? Math.min(top.contentLength, 100 * MIB) + MIB : 0) + 4 * Math.min(60 * MIB, full.contentLength));

  say('Measuring this link...');
  result.baseline = await baseline();
  await save();
  const topPartial = top?.contentLength > 100 * MIB;
  const steps = [
    ['audio', 'audio', audio, false],
    ['video', `${full.height}p video`, full, false],
    ...(top ? [['video', `${top.height}p video${topPartial ? ' (first 100 MiB)' : ''}`, top, topPartial]] : []),
  ];
  for (const [role, label, c, partial] of steps) {
    result.streams.push(c ? await measure(role, label, c, partial) : { role, mode: 'full', pass: false, reason: 'no URL for itag 251 or 140 answers' });
    await save();
  }
  try { result.split = await splitProbe(full); } catch (err) { result.split = { error: String(err?.message ?? err) }; }
  await save();
}

async function runAll() {
  const tabs = (await chrome.tabs.query({ url: '*://www.youtube.com/watch*' })).sort((a, b) => b.lastAccessed - a.lastAccessed);
  if (!tabs.length) throw new Error('No YouTube video tab is open. Open a video, then click Run all again.');
  await chrome.storage.local.remove(Object.keys(await storedResults()));
  await chrome.storage.session.clear();
  delete $('status').dataset.expectBytes;
  const reply = await chrome.tabs.sendMessage(tabs[0].id, { type: 'sieve-run' }).catch(() => {
    throw new Error('The video tab cannot talk to the spike yet. Wait for the video page to finish loading, or reload it, then click Run all again.');
  });
  if (!reply?.ok) throw new Error(`The probe failed: ${reply?.error ?? 'no answer'}. Reload the video tab and try again.`);
  const probes = Object.values(await storedResults());
  const videoId = probes.find((r) => r.videoId)?.videoId ?? null;
  const loggedIn = probes.map((r) => r.loggedIn).find((v) => typeof v === 'boolean') ?? null;
  say('Solving signatures...');
  try { await S3(videoId, loggedIn); }
  catch (err) { await chrome.storage.local.set({ 'probe:S3': { strategy: 'S3', videoId, loggedIn, ejs: EJS, error: String(err?.message ?? err) } }); }
  try { await DL(videoId, loggedIn); }
  catch (err) { await chrome.storage.local.set({ 'probe:DL': { strategy: 'DL', videoId, loggedIn, error: String(err?.message ?? err) } }); }
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
  $('status').setAttribute('aria-busy', 'true');
  say(busy);
  try { say(await fn()); } catch (err) { say(err.message); }
  $('status').removeAttribute('aria-busy');
  await render();
};
$('run').addEventListener('click', guard('Running the probes...', async () => { await runAll(); return 'Done. Results below.'; }));
$('speed').addEventListener('click', guard('Running the speed test...', async () => { await speedTest(); return 'Speed test done. Results below.'; }));
$('save').addEventListener('click', guard('Saving...', async () => `Saved Downloads/${await save()}`));
chrome.storage.onChanged.addListener(render);
render();
