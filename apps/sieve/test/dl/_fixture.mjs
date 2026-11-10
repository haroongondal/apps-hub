// Fixture server for the download e2e. `/limited` throttles to 10 MB/s per response unless `rate` is given, so parallel parts overlap and reach the limit.
// `/flip`: the ETag is "f-<n>" and n goes up when a client hangs up before the end of a body of more than one byte (a killed engine), so the resumed If-Range misses.
import http from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MAX_CHUNK = 1 << 20;
const BASE = Buffer.alloc(251 * 8192);
for (let i = 0; i < BASE.length; i++) BASE[i] = i % 251;

export function pattern(offset, length) {
  const out = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) out[i] = (offset + i) % 251;
  return out;
}

export async function startFixture() {
  const log = [];
  let dropped, tokens, open, flip;
  const reset = () => {
    log.length = 0;
    dropped = new Set();
    tokens = new Set();
    open = new Map();
    flip = new Map();
  };
  reset();

  const drained = (res) =>
    new Promise((ok) => {
      const done = () => (res.off('drain', done), res.off('close', done), ok());
      res.once('drain', done);
      res.once('close', done);
    });

  async function serveFile(req, res, url, kind, size, name, entry) {
    const q = url.searchParams;
    const path = url.pathname;
    const reply = (status, headers = {}, body = '') => {
      entry.status = status;
      res.writeHead(status, headers);
      res.end(body);
    };
    if (kind === 'form' ? req.method !== 'POST' : req.method !== 'GET') return reply(405, { allow: kind === 'form' ? 'POST' : 'GET' });
    req.resume();
    if (kind === 'limited') {
      const n = open.get(path) ?? 0;
      if (n >= Number(q.get('max') ?? 1)) return reply(429, { 'retry-after': '1' });
      open.set(path, n + 1);
      res.on('close', () => open.set(path, (open.get(path) ?? 1) - 1));
    }
    if (q.get('cookie') === '1' && !/(^|;\s*)sid=abc(;|$)/.test(req.headers.cookie ?? '')) return reply(403);
    if (q.has('ref') && req.headers.referer !== q.get('ref')) return reply(403);
    if (q.has('once')) {
      const token = q.get('once');
      if (tokens.has(token)) return reply(403);
      tokens.add(token);
    }
    if (q.has('status')) return reply(Number(q.get('status')));

    const range = req.headers.range ?? null;
    const isProbe = range === 'bytes=0-0';
    let type = q.get('type') ?? 'application/octet-stream';
    let total = size;
    let probeStatus = null;
    if (kind === 'shape' && isProbe) {
      if (q.has('probeDelay')) await sleep(Number(q.get('probeDelay')));
      if (q.has('probeSize')) total = Number(q.get('probeSize'));
      if (q.has('probeType')) type = q.get('probeType');
      if (q.has('probeStatus')) probeStatus = Number(q.get('probeStatus'));
    }
    if (probeStatus !== null) return reply(probeStatus);

    const etag = kind === 'flip' ? `"f-${flip.get(path) ?? 1}"` : `"e-${size}"`;
    const ifRange = req.headers['if-range'] ?? null;
    const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
    const ranged = q.get('ranges') !== 'no' && m !== null && (ifRange === null || ifRange === etag);
    let start = 0;
    let end = size - 1;
    if (ranged) {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      if (start >= size || start > end) return reply(416, { 'content-range': `bytes */${size}` });
    }
    const len = end - start + 1;
    const headers = {
      'content-type': type,
      'accept-ranges': q.get('ranges') === 'no' ? 'none' : 'bytes',
      etag,
      'content-length': String(len),
      'content-disposition': q.get('disposition') === 'inline' ? 'inline' : `attachment; filename="${name}"`,
    };
    if (q.get('enc') === 'gzip') headers['content-encoding'] = 'gzip';
    if (ranged) headers['content-range'] = `bytes ${start}-${end}/${total}`;
    entry.status = ranged ? 206 : 200;
    res.writeHead(entry.status, headers);

    let sent = 0;
    res.on('close', () => {
      if (res.writableFinished) return;
      log.push({ path, closed: true, sent });
      if (kind === 'flip' && len > 1) flip.set(path, (flip.get(path) ?? 1) + 1);
    });
    const rate = Number(q.get('rate') ?? (kind === 'limited' ? 10_000_000 : 0));
    const chunk = Math.min(MAX_CHUNK, rate > 0 ? Math.max(1, Math.floor(rate / 20)) : 256 * 1024);
    const drop = q.has('drop') && !dropped.has(path) ? Number(q.get('drop')) : null;
    while (sent < len && !res.destroyed) {
      let n = Math.min(chunk, len - sent);
      if (drop !== null && sent < drop && drop < len) n = Math.min(n, drop - sent);
      const at = (start + sent) % 251;
      const piece = BASE.subarray(at, at + n);
      sent += n;
      if (drop !== null && sent >= drop && sent < len) {
        dropped.add(path);
        await new Promise((r) => res.write(piece, r));
        res.destroy();
        return;
      }
      const ok = res.write(piece);
      if (rate > 0) await sleep(50);
      else if (!ok) await drained(res);
    }
    res.end();
  }

  const page = (res, entry, html, headers = {}) => {
    entry.status = 200;
    res.writeHead(200, { 'content-type': 'text/html', ...headers });
    res.end(html);
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'log') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(log));
    }
    const entry = { t: Date.now(), method: req.method, path: url.pathname, range: req.headers.range ?? null, ifRange: req.headers['if-range'] ?? null, cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null, status: 0 };
    log.push(entry);
    const reply = (status, headers = {}, body = '') => {
      entry.status = status;
      res.writeHead(status, headers);
      res.end(body);
    };
    const [kind, a, b] = parts;
    if (['file', 'limited', 'flip', 'shape', 'form'].includes(kind) && /^\d+$/.test(a ?? '') && b) {
      return serveFile(req, res, url, kind, Number(a), decodeURIComponent(b), entry);
    }
    if (kind === 'redirect') {
      const hops = Number(a);
      const to = url.searchParams.get('to') ?? '/';
      return reply(302, { location: hops > 1 ? `/redirect/${hops - 1}?to=${encodeURIComponent(to)}` : to });
    }
    if (kind === 'page') {
      const to = url.searchParams.get('to') ?? '/';
      const body =
        url.searchParams.get('method') === 'post'
          ? `<form id=f method=post action="${esc(to)}"></form><script>document.getElementById('f').submit()</script>`
          : `<a id=l href="${esc(to)}">download</a><script>document.getElementById('l').click()</script>`;
      return page(res, entry, body);
    }
    if (kind === 'links') {
      const origin = `http://${req.headers.host}`;
      const link = (n) => `<a href="${origin}/file/1000/l${n}.bin">l${n}</a>`;
      return page(res, entry, `${[1, 2, 3, 4, 5, 1].map(link).join('\n')}<a href="ftp://example.com/x.bin">ftp</a><a href="mailto:a@example.com">mail</a>`);
    }
    if (kind === 'set-cookie') return page(res, entry, 'ok', { 'set-cookie': ['sid=abc; Path=/; SameSite=Lax', 'strict=1; Path=/; SameSite=Strict'] });
    return reply(404);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('fixture:', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((ok) => server.listen(0, ok));
  const { port } = server.address();
  return {
    port,
    base: `http://localhost:${port}`,
    alt: `http://127.0.0.1:${port}`,
    log,
    reset,
    pattern,
    close: () =>
      new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}
