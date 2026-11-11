import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import { DEFAULT_DOWNLOADS, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { SPACE_MARGIN, type ProbeFacts } from '@apps-hub/sieve-core/src/dl-takeover.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { PROBE_TIMEOUT_MS } from '@apps-hub/sieve-core/src/dl-transfer.ts';

(globalThis as unknown as Record<string, unknown>).chrome = { runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext/${p}` } };
const mod = await import('../dl/takeover.ts');
type Deps = import('../dl/takeover.ts').TakeoverDeps;
type RDeps = import('../dl/takeover.ts').RetryDeps;

const SIZE = 20_000_000;
const item = (o: Record<string, unknown> = {}) =>
  ({ id: 7, url: 'https://x.test/pack.zip', finalUrl: 'https://x.test/pack.zip', referrer: 'https://x.test/page', mime: 'application/zip', totalBytes: SIZE, filename: '', state: 'in_progress', paused: false, ...o }) as unknown as chrome.downloads.DownloadItem;
const facts = (o: Partial<ProbeFacts> = {}): ProbeFacts => ({ status: 206, url: 'https://x.test/pack.zip', contentRange: `bytes 0-0/${SIZE}`, contentEncoding: null, mime: 'application/zip', etag: '"e1"', lastModified: null, disposition: null, contentLength: '1', ...o });
const settings = (o: Partial<DownloadSettings> = {}): DownloadSettings => ({ ...DEFAULT_DOWNLOADS, ...o, takeOver: { ...DEFAULT_DOWNLOADS.takeOver, minMb: 1, ...(o.takeOver ?? {}) } });
const rec = (o: Partial<DlRecord> = {}) => ({ id: 'd1', url: 'https://x.test/pack.zip', chromeId: 7, addedAt: 2000, state: 'running', ...o }) as unknown as DlRecord;

function mem(initial: Record<string, unknown> = {}, delay = 0) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (k: unknown) => {
      if (delay) await sleep(delay);
      return k === null ? Object.fromEntries(data) : data.has(k as string) ? { [k as string]: data.get(k as string) } : {};
    },
    set: async (items: Record<string, unknown>) => {
      if (delay) await sleep(delay);
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    remove: async (keys: string | string[]) => void [keys].flat().forEach((k) => data.delete(k)),
  };
}

function fake(o: Partial<Omit<Deps, 'records'>> & { facts?: ProbeFacts; free?: number | null; records?: DlRecord[] | (() => Promise<DlRecord[]>); localDelay?: number } = {}) {
  const calls: string[] = [];
  const local = mem({}, o.localDelay ?? 0);
  const rec2 = (name: string, fn?: unknown) => (async (...a: unknown[]) => {
    calls.push(`${name}${a.length ? ':' + JSON.stringify(a[0]) : ''}`);
    return typeof fn === 'function' ? (fn as (...x: unknown[]) => unknown)(...a) : undefined;
  }) as never;
  const added: unknown[] = [];
  const store: DlRecord[] = Array.isArray(o.records) ? [...o.records] : [];
  const deps: Deps = {
    extensionId: 'ext',
    settings: async () => settings(),
    pause: rec2('pause'),
    resume: rec2('resume'),
    cancel: rec2('cancel'),
    erase: rec2('erase'),
    search: async () => (calls.push('search'), { state: 'in_progress', paused: true, filename: '/Users/x/Downloads/Pack.zip.crdownload' }),
    freeBytes: async () => (calls.push('freeBytes'), o.free === undefined ? null : o.free),
    probe: async () => (calls.push('probe'), o.facts ?? facts()),
    add: async (items) => {
      calls.push('add');
      await sleep(20);
      added.push(...items);
      store.push(rec({ chromeId: items[0].chromeId, url: items[0].url, addedAt: 5000, state: 'queued' }));
      calls.push('add-resolved');
      return { ids: ['d1'] };
    },
    records: async () => (typeof o.records === 'function' ? o.records() : store),
    remove: rec2('remove'),
    local,
    session: mem(),
    now: () => 5000,
    startedAt: 9000,
    ...(({ facts: _f, free: _r, records: _c, localDelay: _l, ...rest }) => rest)(o),
  } as Deps;
  return { deps, calls, local, added };
}

test('a take-over writes the entry, pauses, probes, adds, and only then cancels and erases', async () => {
  const f = fake({ localDelay: 15 });
  let keyAtPause: unknown;
  const pause = f.deps.pause;
  f.deps.pause = async (id) => {
    keyAtPause = f.local.data.get('dlTakeover:7');
    return pause(id);
  };
  await mod.onCreated(item(), f.deps);
  assert.deepEqual(keyAtPause, { at: 5000, url: 'https://x.test/pack.zip' });
  assert.deepEqual(f.calls, ['pause:7', 'search', 'probe', 'freeBytes', 'add', 'add-resolved', 'cancel:7', 'erase:7']);
  assert.equal(f.local.data.size, 0);
  assert.deepEqual(f.added, [{ url: 'https://x.test/pack.zip', referrer: 'https://x.test/page', source: 'takeover', chromeId: 7, probed: { finalUrl: 'https://x.test/pack.zip', size: SIZE, mime: 'application/zip', validator: '"e1"', name: 'Pack.zip' } }]);
});

for (const [reason, o] of [
  ['probe-failed', { facts: { ...facts(), error: 'Failed to fetch', status: 0 } }],
  ['no-range', { facts: facts({ status: 200 }) }],
  ['status-403', { facts: facts({ status: 403 }) }],
  ['encoded', { facts: facts({ contentEncoding: 'gzip' }) }],
  ['no-size', { facts: facts({ contentRange: 'bytes 0-0/*' }) }],
  ['size-differs', { facts: facts({ contentRange: 'bytes 0-0/19999999' }) }],
  ['type-differs', { facts: facts({ mime: 'text/html' }) }],
  ['no-space', { free: 2 * SIZE + SPACE_MARGIN - 1 }],
] as const) {
  test(`a probe verdict of ${reason} resumes Chrome's download and never adds, cancels or erases`, async () => {
    const f = fake(o);
    await mod.onCreated(item(), f.deps);
    assert.ok(f.calls.includes('resume:7'));
    for (const never of ['add', 'cancel:7', 'erase:7']) assert.ok(!f.calls.includes(never), never);
    assert.equal(f.local.data.size, 0);
  });
}

for (const [name, it, s, session] of [
  ['a blob: item', item({ url: 'blob:chrome-extension://ext/abc', finalUrl: 'blob:chrome-extension://ext/abc' }), settings(), {}],
  ['a small file', item({ totalBytes: 500_000 }), settings(), {}],
  ['downloads.on false', item(), settings({ on: false }), {}],
  ['takeOver.on false', item(), settings({ takeOver: { ...DEFAULT_DOWNLOADS.takeOver, on: false } }), {}],
  ['a retry URL', item(), settings(), { 'dlRetry:https://x.test/pack.zip': 9999 }],
  ['an item of this extension', item({ byExtensionId: 'ext' }), settings(), {}],
] as const) {
  test(`${name} is not taken over and nothing is called`, async () => {
    const f = fake();
    f.deps.settings = async () => s;
    f.deps.session = mem(session);
    await mod.onCreated(it, f.deps);
    assert.deepEqual(f.calls, []);
  });
}

test('an expired retry URL does not protect the item', async () => {
  const f = fake();
  f.deps.session = mem({ 'dlRetry:https://x.test/pack.zip': 4000 });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('pause:7'));
});

test('failures: add null or throwing resumes; cancel rejecting removes the record and resumes; erase rejecting is ignored; pause rejecting makes no probe', async () => {
  let f = fake({ add: async () => null });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('resume:7') && !f.calls.includes('cancel:7'));

  f = fake({ add: async () => { throw new Error('boom'); } });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('resume:7') && !f.calls.includes('cancel:7'));

  f = fake({ cancel: async () => { throw new Error('nope'); } });
  await mod.onCreated(item(), f.deps);
  assert.deepEqual(f.calls.slice(-3), ['add-resolved', 'remove:["d1"]', 'resume:7']);
  assert.equal(f.local.data.size, 0);

  f = fake({ erase: async () => { throw new Error('nope'); } });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('cancel:7') && !f.calls.includes('resume:7'));
  assert.equal(f.local.data.size, 0);

  f = fake({ pause: async () => { throw new Error('gone'); } });
  await mod.onCreated(item(), f.deps);
  assert.ok(!f.calls.includes('probe') && !f.calls.includes('resume:7'));
  assert.equal(f.local.data.size, 0);
});

test('an add that gets no answer but whose record the engine holds finishes the cancel instead of resuming', async () => {
  const f = fake({ add: async () => null, records: [rec({ addedAt: 5000 })] });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('cancel:7') && f.calls.includes('erase:7') && !f.calls.includes('resume:7'));
});

test('an add that returns a stale record is not trusted: Chrome is resumed and nothing is cancelled', async () => {
  const stale = rec({ id: 'old', addedAt: 100, state: 'failed' });
  const f = fake({ records: async () => [stale], add: async () => ({ ids: ['old'] }) });
  await mod.onCreated(item(), f.deps);
  assert.ok(f.calls.includes('resume:7') && !f.calls.includes('cancel:7') && !f.calls.includes('erase:7'));
  assert.equal(f.local.data.size, 0);
});

test('an incognito download is never paused, probed or taken over', async () => {
  const f = fake();
  await mod.onCreated(item({ incognito: true }), f.deps);
  assert.deepEqual(f.calls, []);
  assert.equal(f.local.data.size, 0);
});

test('an exception between the pause and the add resumes Chrome and removes the entry', async () => {
  const f = fake({ probe: async () => { throw new Error('probe contract broken'); } });
  await assert.rejects(mod.onCreated(item(), f.deps));
  assert.ok(f.calls.includes('resume:7'));
  assert.equal(f.local.data.size, 0);
});

test('realProbe times out after PROBE_TIMEOUT_MS through an AbortSignal and gives probe-failed facts', async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const chromeStub = g.chrome as Record<string, unknown>;
  chromeStub.declarativeNetRequest = { updateSessionRules: async () => {} };
  const realFetch = g.fetch;
  let aborted = false;
  g.fetch = (_u: string, init: { signal: AbortSignal }) => new Promise((_, rej) => init.signal.addEventListener('abort', () => ((aborted = true), rej(new DOMException('timed out', 'TimeoutError')))));
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    assert.equal(ms, PROBE_TIMEOUT_MS);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    return ac.signal;
  };
  try {
    const facts = await mod.realProbe({ url: 'https://x.test/a', finalUrl: 'https://x.test/b', referrer: '', mime: '', totalBytes: 1 });
    assert.ok(aborted && facts.error !== undefined && facts.status === 0);
  } finally {
    g.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  }
});

test('realProbe adds a Referer rule for the original URL and the redirect target and removes both', async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const ops: { addRules?: { condition: { urlFilter: string } }[]; removeRuleIds?: number[] }[] = [];
  (g.chrome as Record<string, unknown>).declarativeNetRequest = { updateSessionRules: async (o: never) => void ops.push(o) };
  const realFetch = g.fetch;
  g.fetch = async () => new Response(null, { status: 206, headers: { 'content-range': 'bytes 0-0/10' } });
  try {
    const facts = await mod.realProbe({ url: 'https://x.test/a', finalUrl: 'https://x.test/b', referrer: 'https://x.test/p', mime: '', totalBytes: 10 });
    assert.equal(facts.status, 206);
  } finally {
    g.fetch = realFetch;
  }
  const filters = ops.flatMap((o) => o.addRules ?? []).map((r) => r.condition.urlFilter);
  assert.deepEqual(filters, ['|https://x.test/a|', '|https://x.test/b|']);
  assert.equal(ops.filter((o) => !o.addRules).length, 2);
});

test('replay: a worker that died before the cancel finished is finished by recoverPaused: one record, one completed cancel, no resume', async () => {
  const records = new Map<number, string>();
  let completedCancels = 0;
  let hang = true;
  const make = () => {
    const f = fake({
      records: async () => [...records].map(([chromeId, id]) => rec({ id, chromeId, addedAt: 5000 })),
      add: async (items) => {
        const chromeId = items[0].chromeId as number;
        if (!records.has(chromeId)) records.set(chromeId, 'd1');
        return { ids: [records.get(chromeId) as string] };
      },
      cancel: async () => {
        if (hang) return new Promise<void>(() => {});
        completedCancels++;
      },
    });
    return f;
  };
  const first = make();
  void mod.onCreated(item(), first.deps);
  await sleep(30);
  hang = false;
  const second = make();
  second.local.data.set('dlTakeover:7', first.local.data.get('dlTakeover:7'));
  second.deps.search = async () => ({ state: 'in_progress', paused: true, filename: '' });
  await mod.recoverPaused(second.deps);
  assert.equal(records.size, 1);
  assert.equal(completedCancels, 1);
  assert.ok(!second.calls.includes('resume:7'));
  assert.equal(second.local.data.size, 0);
});

const entry = (at = 1000, url = 'https://x.test/pack.zip') => ({ at, url });
async function recover(initial: Record<string, unknown>, o: Parameters<typeof fake>[0], searchResult: { state: string; paused: boolean; filename: string } | undefined) {
  const f = fake({ search: async () => searchResult, ...o });
  f.local.data.clear();
  for (const [k, v] of Object.entries(initial)) f.local.data.set(k, v);
  await mod.recoverPaused(f.deps);
  return f;
}

test('recoverPaused resumes a paused item in progress and not a finished one', async () => {
  let f = await recover({ 'dlTakeover:7': entry(), other: 1 }, {}, { state: 'in_progress', paused: true, filename: '' });
  assert.deepEqual(f.calls, ['resume:7']);
  assert.deepEqual([...f.local.data.keys()], ['other']);
  f = await recover({ 'dlTakeover:7': entry() }, {}, { state: 'complete', paused: false, filename: '' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.local.data.size, 0);
  f = await recover({ 'dlTakeover:7': entry() }, {}, undefined);
  assert.deepEqual(f.calls, []);
  assert.equal(f.local.data.size, 0);
});

test('recoverPaused leaves an entry younger than the worker alone', async () => {
  const f = await recover({ 'dlTakeover:7': entry(9500) }, {}, { state: 'in_progress', paused: true, filename: '' });
  assert.deepEqual(f.calls, []);
  assert.equal(f.local.data.size, 1);
});

test('recoverPaused cancels and erases an item the engine already holds, and does not resume it', async () => {
  const f = await recover({ 'dlTakeover:7': entry() }, { records: [rec({ addedAt: 1000 })] }, { state: 'in_progress', paused: true, filename: '' });
  assert.deepEqual(f.calls, ['cancel:7', 'erase:7']);
  assert.equal(f.local.data.size, 0);
});

test('recoverPaused ignores a stale done record, a record added before the entry and a record with another url or id', async () => {
  for (const r of [rec({ state: 'done' }), rec({ url: 'https://x.test/other.zip' }), rec({ addedAt: 999 }), rec({ chromeId: 8 })]) {
    const f = await recover({ 'dlTakeover:7': entry() }, { records: [r] }, { state: 'in_progress', paused: true, filename: '' });
    assert.deepEqual(f.calls, ['resume:7']);
    assert.equal(f.local.data.size, 0);
  }
});

test('recoverPaused resumes when the records cannot be read, and carries on after one entry fails', async () => {
  const f = fake({ records: async () => { throw new Error('idb'); } });
  f.deps.search = async () => ({ state: 'in_progress', paused: true, filename: '' });
  f.local.data.set('dlTakeover:7', entry());
  f.local.data.set('dlTakeover:8', entry());
  let first = true;
  f.deps.resume = async (id) => {
    f.calls.push(`resume:${id}`);
    if (first) { first = false; throw new Error('gone'); }
  };
  console.error = () => {};
  await mod.recoverPaused(f.deps);
  assert.deepEqual(f.calls, ['resume:7', 'resume:8']);
  assert.equal(f.local.data.size, 0);
});

function retryFake(o: { records?: DlRecord[]; download?: (u: string) => Promise<number>; bytes?: (poll: number) => number; state?: string } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const session = mem();
  const origSet = session.set;
  session.set = async (items) => {
    calls.push('set:' + Object.keys(items).join(','));
    return origSet(items);
  };
  const deps: RDeps = {
    records: async () => o.records ?? [{ ...rec({ id: 'd1', url: 'https://x.test/a.zip' }), finalUrl: 'https://x.test/b.zip' } as DlRecord],
    download: async (u) => {
      calls.push('download:' + u);
      return o.download ? o.download(u) : 33;
    },
    search: async () => ({ state: o.state ?? 'in_progress', bytesReceived: o.bytes ? o.bytes(++polls) : 0 }),
    remove: async (ids) => void calls.push('remove:' + ids.join(',')),
    session,
    now: () => 1000,
    sleep: async (ms) => void calls.push('sleep:' + ms),
  };
  return { deps, calls, session };
}

test('retryInChrome writes the retry keys before download and removes the record only after a byte arrived', async () => {
  const f = retryFake({ bytes: (n) => (n >= 3 ? 10 : 0) });
  assert.deepEqual(await mod.retryInChrome('d1', f.deps), { ok: true });
  assert.deepEqual(f.calls, ['set:dlRetry:https://x.test/a.zip,dlRetry:https://x.test/b.zip', 'download:https://x.test/a.zip', 'sleep:500', 'sleep:500', 'sleep:500', 'remove:d1']);
  assert.equal(f.session.data.get('dlRetry:https://x.test/a.zip'), 1000 + 120_000);
});

test('retryInChrome keeps a whole private copy unless Chrome has the whole file', async () => {
  const saveOnly = [{ ...rec({ id: 'd1', url: 'https://x.test/a.zip' }), finalUrl: 'https://x.test/a.zip', saveOnly: true, size: 10 } as DlRecord];
  for (const o of [{ bytes: () => 10 }, { state: 'complete', bytes: () => 5000 }, { state: 'interrupted', bytes: () => 10 }]) {
    const f = retryFake({ records: saveOnly, ...o });
    assert.deepEqual(await mod.retryInChrome('d1', f.deps), { ok: true });
    assert.ok(!f.calls.some((c) => c.startsWith('remove')), JSON.stringify(o));
  }
  const g = retryFake({ records: saveOnly, state: 'complete', bytes: () => 10 });
  await mod.retryInChrome('d1', g.deps);
  assert.ok(g.calls.includes('remove:d1'));
});

test('retryInChrome keeps a partial record when Chrome interrupts with some bytes', async () => {
  const f = retryFake({ state: 'interrupted', bytes: () => 10 });
  await mod.retryInChrome('d1', f.deps);
  assert.ok(!f.calls.some((c) => c.startsWith('remove')));
});

test('retryInChrome removes the record when the Chrome download is already complete', async () => {
  const f = retryFake({ state: 'complete' });
  await mod.retryInChrome('d1', f.deps);
  assert.ok(f.calls.includes('remove:d1'));
});

test('retryInChrome keeps the record when no byte shows within 10 seconds and still answers ok', async () => {
  const f = retryFake();
  assert.deepEqual(await mod.retryInChrome('d1', f.deps), { ok: true });
  assert.equal(f.calls.filter((c) => c === 'sleep:500').length, 20);
  assert.ok(!f.calls.some((c) => c.startsWith('remove')));
});

test('retryInChrome: a rejected download deletes the retry keys and answers retryRefused; an unknown id answers retryGone', async () => {
  const f = retryFake({ download: async () => { throw new Error('no'); } });
  assert.deepEqual(await mod.retryInChrome('d1', f.deps), { ok: false, message: T.retryRefused });
  assert.equal(f.session.data.size, 0);
  const g = retryFake();
  assert.deepEqual(await mod.retryInChrome('nope', g.deps), { ok: false, message: T.retryGone });
  assert.deepEqual(g.calls, []);
});

test('the dl-retry-chrome handler ignores a web page and answers an extension page', async () => {
  const listeners: ((m: unknown, s: { url?: string }, r: (x: unknown) => void) => boolean)[] = [];
  const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  c.downloads = { onCreated: { addListener: () => {} } };
  (c.runtime as Record<string, unknown>).onMessage = { addListener: (l: never) => void listeners.push(l) };
  c.storage = { local: mem(), session: mem() };
  mod.initTakeover();
  const handler = listeners[0];
  let reply: unknown = 'none';
  assert.equal(handler({ type: 'dl-retry-chrome', id: 'd1' }, { url: 'https://evil.test/' }, (x) => (reply = x)), false);
  assert.equal(reply, 'none');
  assert.equal(handler({ type: 'other' }, { url: 'chrome-extension://ext/list.html' }, () => {}), false);
  assert.equal(handler({ type: 'dl-retry-chrome', id: 5 }, { url: 'chrome-extension://ext/list.html' }, (x) => (reply = x)), false);
  assert.deepEqual(reply, { ok: false, message: T.retryGone });
});
