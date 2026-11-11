import { makeBucket, setRate, take } from './dl-bucket.ts';
import {
  GIVE_UP_MS, HOST_MAX, MAX_ATTEMPTS, STALL_MS, backoffMs, capFor, hostOf, isPartComplete, nextToStart, onRefused,
  parseRetryAfter, partLength, planParts, resplit,
} from './dl-plan.ts';
import type { HostCaps } from './dl-plan.ts';
import type { Clock, FileHandle, Files, Net, NetResponse, Store, Transfer, TransferHooks, TransferResult } from './dl-ports.ts';
import { ERRORS, isComplete, partName } from './dl-record.ts';
import type { DlRecord } from './dl-record.ts';
import type { DownloadSettings } from './dl-settings.ts';
import { categoryOf, chooseName, factsFromError, factsFromResponse, normaliseMime, parseRangeTotal, validatorOf } from './dl-takeover.ts';
import type { ProbeFacts } from './dl-takeover.ts';

export const CHECKPOINT_BYTES = 4_194_304; // persist a checkpoint after this many bytes
export const CHECKPOINT_MS = 2000; // or after this long, whichever comes first
export const PROBE_TIMEOUT_MS = 8000;

export interface TransferDeps {
  net: Net;
  files: Files;
  store: Store;
  clock: Clock;
}

const POLL_MS = 250; // a start that must wait for a host slot polls this often
const MIN_FREE_BYTES = 10_000_000; // below this a failed write is "no space"

// Fail ends the download and its message is the stored sentence; Retry is worth another request from the saved offset.
class Fail extends Error {}
class Retry extends Error {}

const clone = (r: DlRecord): DlRecord => ({ ...r, parts: r.parts.map((p) => ({ ...p })) });

// GET with `Range: bytes=0-0`; cancels the body; never throws: a failure is `factsFromError`.
export async function probe(net: Net, url: string, clock: Clock, signal?: AbortSignal): Promise<ProbeFacts> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal?.aborted) ac.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  void clock.sleep(PROBE_TIMEOUT_MS, ac.signal).then(
    () => { timedOut = true; ac.abort(); },
    () => {},
  );
  try {
    const res = await net.fetch(url, { range: 'bytes=0-0', signal: ac.signal });
    const facts = factsFromResponse(res);
    try { await res.body?.cancel(); } catch { /* the body is not needed */ }
    return facts;
  } catch (e) {
    return factsFromError(timedOut ? 'timed out' : e instanceof Error ? e.message : String(e), url);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    ac.abort(); // also ends the timeout sleep
  }
}

const STALLED = Symbol('stalled');
const SPENT = Symbol('spent'); // the timer was cancelled: only after the read already won
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i;

export function createTransfer(deps: TransferDeps): Transfer {
  const { net, files, store, clock } = deps;
  let settings: DownloadSettings | null = null;
  const bucket = makeBucket(Infinity, clock.now());
  const use: Record<string, number> = {}; // host -> open connections, shared by every run of this instance
  let caps: HostCaps = {};
  let capsReady: Promise<void> = Promise.resolve();
  let runs = 0;

  async function noteRefused(host: string, open: number): Promise<void> {
    caps = onRefused(caps, host, open, clock.now());
    try { await store.setMeta('hostCaps', caps); } catch { /* the cap still holds in memory */ }
  }

  async function drain(n: number, signal: AbortSignal): Promise<void> {
    let rest = n;
    while (rest > 0) {
      const g = take(bucket, rest, clock.now());
      rest -= g.grant;
      if (g.waitMs > 0) await clock.sleep(g.waitMs, signal);
    }
  }

  async function run(record: DlRecord, outer: AbortSignal, hooks: TransferHooks): Promise<TransferResult> {
    const r = clone(record);
    const inner = new AbortController();
    const link = () => inner.abort();
    if (outer.aborted) inner.abort();
    else outer.addEventListener('abort', link, { once: true });
    const sig = inner.signal;
    let handle: FileHandle | null = null;
    if (runs++ === 0) capsReady = store.getMeta<HostCaps>('hostCaps').then((v) => { caps = v ?? {}; }, () => { caps = {}; });
    const hostName = () => hostOf(r.finalUrl) || hostOf(r.url);

    async function acquire(host: string): Promise<void> {
      for (;;) {
        if (sig.aborted) throw new Error('aborted');
        if ((use[host] ?? 0) < capFor(caps, host, HOST_MAX, clock.now())) {
          use[host] = (use[host] ?? 0) + 1;
          return;
        }
        await clock.sleep(POLL_MS, sig);
      }
    }

    async function probeStep(): Promise<void> {
      let errors = 0;
      let refusals = 0;
      let attempt = 0;
      const since = clock.now();
      for (;;) {
        if (sig.aborted) return;
        const f = await probe(net, r.url, clock, sig);
        if (sig.aborted) return;
        if (f.status === 0 || f.error !== undefined) {
          if (++errors >= 3) throw new Fail(ERRORS.probe); // waiting will not help: the next step is Retry in Chrome
          await clock.sleep(backoffMs(errors), sig);
          continue;
        }
        if (f.status === 429 || f.status === 503) {
          refusals++;
          await noteRefused(hostName(), 1);
          if (refusals >= MAX_ATTEMPTS) throw new Fail(ERRORS.refused);
          await clock.sleep(backoffMs(refusals, parseRetryAfter(f.retryAfter ?? null, clock.now())), sig);
          continue;
        }
        if (f.status >= 400 && f.status < 500) throw new Fail(ERRORS.status(f.status));
        if (f.status >= 500) {
          if (clock.now() - since >= GIVE_UP_MS) throw new Fail(ERRORS.network);
          await clock.sleep(backoffMs(++attempt), sig);
          continue;
        }
        if (f.status !== 200 && f.status !== 206) throw new Fail(ERRORS.status(f.status));
        const mime = normaliseMime(f.mime);
        const total = f.status === 206 ? parseRangeTotal(f.contentRange) : null;
        const length = f.contentLength === null ? NaN : Number(f.contentLength);
        r.rangeOk = f.status === 206 && total !== null;
        r.size = f.status === 206 ? total : Number.isFinite(length) && length >= 0 ? length : null;
        r.validator = r.rangeOk ? validatorOf(f) : null;
        r.mime = mime;
        r.finalUrl = f.url;
        if (r.source !== 'takeover') r.name = chooseName({ disposition: f.disposition, url: f.url, mime });
        if (!r.categoryFixed && settings) r.category = categoryOf(r.name, mime, settings.categories);
        return;
      }
    }

    const state: { attempt: number; refusals: number; since: number }[] = [];
    let bytesSince = 0;
    let lastCheckpoint = 0;

    async function checkpoint(h: FileHandle): Promise<void> {
      bytesSince = 0;
      lastCheckpoint = clock.now();
      try {
        h.flush(); // the bytes are on disk before the record says so
        await hooks.persist(clone(r));
      } catch {
        throw new Fail(ERRORS.storage);
      }
    }

    async function writeChunk(h: FileHandle, at: number, chunk: Uint8Array): Promise<void> {
      try {
        h.write(chunk, at);
      } catch {
        let free = Infinity;
        try { const s = await files.space(); free = s.quota - s.usage; } catch { /* unknown: assume room */ }
        throw new Fail(free < MIN_FREE_BYTES ? ERRORS.space : ERRORS.storage);
      }
    }

    async function readBody(h: FileHandle, i: number, res: NetResponse, req: AbortController): Promise<void> {
      if (!res.body) throw new Retry('no body');
      const reader = res.body.getReader();
      const s = state[i];
      try {
        for (;;) {
          // The stall timer wraps only the read, so time slept for the speed limit never counts.
          const stallAc = new AbortController();
          const stall = clock.sleep(STALL_MS, stallAc.signal).then(() => STALLED, () => SPENT);
          const rd = reader.read();
          rd.catch(() => {}); // a read left behind by a stall rejects when the request aborts
          let got;
          try { got = await Promise.race([rd, stall]); } finally { stallAc.abort(); }
          if (typeof got === 'symbol') { req.abort(); throw new Retry('stalled'); }
          if (got.done) break;
          let chunk = got.value;
          let q = r.parts[i];
          if (q.end !== null && q.start + q.done > q.end) break; // a re-split gave the rest away
          if (q.end !== null) chunk = chunk.subarray(0, Math.min(chunk.length, q.end + 1 - (q.start + q.done)));
          await drain(chunk.length, sig);
          q = r.parts[i]; // a re-split may have shortened the part while the bucket slept
          const at = q.start + q.done;
          if (q.end !== null) {
            if (at > q.end) break;
            chunk = chunk.subarray(0, Math.min(chunk.length, q.end + 1 - at));
          }
          await writeChunk(h, at, chunk);
          q = r.parts[i]; // the write was awaited: a re-split may have replaced the part object
          q.done += chunk.length;
          s.attempt = 0; s.refusals = 0; s.since = clock.now();
          hooks.bytes(chunk.length);
          hooks.update(clone(r));
          bytesSince += chunk.length;
          if (bytesSince >= CHECKPOINT_BYTES || clock.now() - lastCheckpoint >= CHECKPOINT_MS) await checkpoint(h);
          q = r.parts[i];
          if (q.end !== null && q.start + q.done > q.end) break;
        }
      } finally {
        reader.cancel().catch(() => {});
      }
      const q = r.parts[i];
      if (q.end === null) q.end = q.start + q.done - 1; // unknown length: the stream's end is the end
      else if (q.done < partLength(q)) throw new Retry('stream ended early');
    }

    async function runPart(h: FileHandle, i: number): Promise<void> {
      const s = state[i] ??= { attempt: 0, refusals: 0, since: clock.now() };
      for (;;) {
        if (sig.aborted || isPartComplete(r.parts[i])) return;
        const host = hostName();
        const waitedFrom = clock.now();
        await acquire(host);
        s.since += clock.now() - waitedFrom; // waiting for a slot is not a failure and does not run the 15 minutes
        let held = true;
        const req = new AbortController();
        // Aborting also closes a response whose body was never read (a refusal, an error status): its socket must not outlive the slot.
        const free = () => { req.abort(); if (held) { held = false; use[host]--; } };
        const stop = () => req.abort();
        sig.addEventListener('abort', stop, { once: true });
        try {
          const p = r.parts[i];
          const at = p.start + p.done;
          const res = await net.fetch(r.url, {
            // a record with one part asks for the rest of the file, as the plan's examples do
            range: r.rangeOk ? `bytes=${at}-${r.parts.length === 1 ? '' : p.end ?? ''}` : undefined,
            ifRange: r.rangeOk && r.validator ? r.validator : undefined,
            signal: req.signal,
          });
          const code = res.status;
          if (code === 206 && r.rangeOk) {
            const cr = res.headers.get('content-range');
            const m = cr === null ? null : CONTENT_RANGE.exec(cr);
            if (!m || Number(m[1]) !== at) throw new Fail(ERRORS.length);
            if (parseRangeTotal(cr) !== r.size) throw new Fail(ERRORS.changed);
            const v = validatorOf({ etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') });
            if (r.validator && v !== null && v !== r.validator) throw new Fail(ERRORS.changed);
            await readBody(h, i, res, req);
            return;
          }
          if (code === 200 && !r.rangeOk) {
            await readBody(h, i, res, req);
            return;
          }
          if (code === 200 || code === 416 || code === 206) throw new Fail(ERRORS.changed);
          if (code === 429 || code === 503) {
            s.refusals++;
            await noteRefused(host, use[host] ?? 1); // the count still includes this refused connection
            free();
            if (s.refusals >= MAX_ATTEMPTS) throw new Fail(ERRORS.refused);
            await clock.sleep(backoffMs(s.refusals, parseRetryAfter(res.headers.get('retry-after'), clock.now())), sig);
            continue;
          }
          if (code >= 400 && code < 500) throw new Fail(ERRORS.status(code));
          throw new Retry(`status ${code}`);
        } catch (e) {
          if (e instanceof Fail) throw e;
          if (sig.aborted) return;
          free();
          s.refusals = 0;
          s.attempt++;
          if (clock.now() - s.since >= GIVE_UP_MS) throw new Fail(ERRORS.network);
          if (!r.rangeOk) r.parts[i].done = 0; // a server that cannot resume restarts from the start
          await clock.sleep(backoffMs(s.attempt), sig);
        } finally {
          sig.removeEventListener('abort', stop);
          free();
        }
      }
    }

    async function body(): Promise<'done' | 'paused'> {
      await capsReady;
      if (r.size === null && r.parts.length === 0) await probeStep();
      if (sig.aborted) return 'paused';
      if (r.parts.length === 0) {
        if (r.rangeOk && r.size !== null) r.parts = planParts(r.size, capFor(caps, hostName(), r.partsWanted, clock.now()));
        else r.parts = [{ start: 0, end: r.size === null ? null : r.size - 1, done: 0 }];
      } else if (!r.rangeOk) {
        for (const p of r.parts) p.done = 0;
      }
      hooks.update(clone(r));
      const h = (handle = await files.open(partName(r.id), r.size));
      // The part file was lost or cut short while the record survived: bytes below `done` are zeros now, so start over.
      const reached = Math.max(0, ...r.parts.filter((p) => p.done > 0).map((p) => p.start + p.done));
      if (reached > 0 && (h.existingSize === null || (h.existingSize < reached && (r.size === null || h.existingSize < r.size)))) {
        for (const p of r.parts) p.done = 0;
        hooks.update(clone(r));
        try { await hooks.persist(clone(r)); } catch { throw new Fail(ERRORS.storage); }
      }
      lastCheckpoint = clock.now();
      const active = new Map<number, Promise<{ i: number; error?: unknown }>>();
      let failure: Fail | null = null;
      while (!failure && !sig.aborted && !(r.size !== null && isComplete(r))) {
        const allowed = r.rangeOk ? capFor(caps, hostName(), r.partsWanted, clock.now()) : 1;
        while (active.size < allowed) {
          const open = [...active.keys()];
          let i = nextToStart(r.parts, open);
          if (i === null && allowed > 1) {
            const split = resplit(r.parts, open);
            if (split) { r.parts = split.parts; i = split.added; }
          }
          if (i === null) break;
          const idx = i;
          active.set(idx, runPart(h, idx).then(() => ({ i: idx }), (error) => ({ i: idx, error })));
        }
        if (active.size === 0) break;
        const settled = await Promise.race(active.values());
        active.delete(settled.i);
        if (settled.error !== undefined && !failure) {
          if (settled.error instanceof Fail) failure = settled.error;
          else if (!sig.aborted) failure = new Fail(ERRORS.unknown);
          if (failure) inner.abort();
        }
      }
      await Promise.all(active.values()); // every part has stopped before the file closes
      if (failure) throw failure;
      return sig.aborted ? 'paused' : 'done';
    }

    async function finish(kind: 'done' | 'paused' | 'failed', error?: string): Promise<TransferResult> {
      let result: TransferResult;
      if (kind === 'failed') {
        r.error = error ?? ERRORS.unknown;
        result = { kind, record: r, error: r.error };
      } else {
        result = { kind, record: r };
      }
      const h = handle as FileHandle | null;
      try { h?.flush(); } catch { /* the persisted record is what counts */ }
      const persist = async () => {
        try {
          await hooks.persist(clone(r));
        } catch {
          if (result.kind === 'done') {
            r.error = ERRORS.storage;
            result = { kind: 'failed', record: r, error: ERRORS.storage };
          }
        }
      };
      const close = () => { try { h?.close(); } catch { /* already closed */ } };
      if (kind === 'done') {
        if (h && r.size !== null && h.size() < r.size) {
          r.error = ERRORS.length;
          result = { kind: 'failed', record: r, error: ERRORS.length };
        }
        close();
        await persist();
      } else {
        await persist();
        close();
      }
      return result;
    }

    try {
      let outcome: 'done' | 'paused';
      try {
        outcome = await body();
      } catch (e) {
        return await finish('failed', e instanceof Fail ? e.message : ERRORS.unknown);
      }
      if (outcome === 'paused') return await finish('paused');
      if (r.size === null) r.size = r.parts.reduce((n, p) => n + p.done, 0);
      if (!isComplete(r)) return await finish('failed', ERRORS.length);
      return await finish('done');
    } finally {
      outer.removeEventListener('abort', link);
      runs--;
    }
  }

  return {
    run,
    config(s: DownloadSettings): void {
      settings = s;
      setRate(bucket, s.speedLimit.on ? s.speedLimit.kbPerSecond * 1000 : Infinity, clock.now());
    },
  };
}
