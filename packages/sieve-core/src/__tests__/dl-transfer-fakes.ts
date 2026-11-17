import type { Clock, FileHandle, Files, Net, NetResponse, Store } from '../dl-ports.ts';
import { newRecord } from '../dl-record.ts';
import type { DlRecord } from '../dl-record.ts';

export const PATTERN = 251;
export const MiB = 1_048_576;

export function pattern(offset: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (offset + i) % PATTERN;
  return out;
}

export function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

// Virtual time moves only inside drive(): every ready promise runs before the earliest timer fires.
export class ManualClock implements Clock {
  t = 0;
  timers: { at: number; seq: number; fire: () => void }[] = [];
  seq = 0;
  sleeps: number[] = [];
  now(): number { return this.t; }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(abortError()); return; }
      this.sleeps.push(ms);
      const timer = { at: this.t + ms, seq: this.seq++, fire: () => { signal?.removeEventListener('abort', onAbort); resolve(); } };
      const onAbort = () => {
        this.timers = this.timers.filter((x) => x !== timer);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.timers.push(timer);
    });
  }
  every(): () => void { return () => {}; }
  async drive<T>(p: Promise<T>): Promise<T> {
    let finished = false;
    p.then(() => { finished = true; }, () => { finished = true; });
    for (;;) {
      for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
      if (finished) return p;
      if (this.timers.length === 0) throw new Error('deadlock');
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = Math.max(this.t, next.at);
      next.fire();
    }
  }
}

export interface LogEntry { op: 'write' | 'flush' | 'close' | 'persist' | 'open'; at?: number; n?: number; t: number }

export class FakeFiles implements Files {
  data = new Map<string, Uint8Array>();
  log: LogEntry[];
  free = 100 * 1024 * MiB;
  failWrite = false;
  shortBy = 0; // handle.size() reports this many bytes less
  maxWrite = 0;
  writeCount = 0;
  openedSizes: (number | null)[] = [];
  clock: ManualClock;
  constructor(clock: ManualClock, log?: LogEntry[]) { this.clock = clock; this.log = log ?? []; }
  async open(name: string, length: number | null): Promise<FileHandle> {
    this.openedSizes.push(length);
    const existingSize = this.data.get(name)?.length ?? null;
    let buf = this.data.get(name) ?? new Uint8Array(0);
    if (length !== null && buf.length !== length) {
      const next = new Uint8Array(length);
      next.set(buf.subarray(0, Math.min(buf.length, length)));
      buf = next;
    }
    this.data.set(name, buf);
    let closed = false;
    const me = this;
    return {
      existingSize,
      write: (chunk: Uint8Array, at: number) => {
        if (closed) throw new Error('write after close');
        if (me.failWrite) throw new Error('quota exceeded');
        me.maxWrite = Math.max(me.maxWrite, chunk.length);
        me.writeCount++;
        let b = me.data.get(name)!;
        if (at + chunk.length > b.length) { const g = new Uint8Array(at + chunk.length); g.set(b); b = g; me.data.set(name, b); }
        b.set(chunk, at);
        me.log.push({ op: 'write', at, n: chunk.length, t: me.clock.t });
      },
      flush: () => { me.log.push({ op: 'flush', t: me.clock.t }); },
      size: () => me.data.get(name)!.length - me.shortBy,
      truncate: (n: number) => { const b = me.data.get(name)!; const next = new Uint8Array(n); next.set(b.subarray(0, Math.min(n, b.length))); me.data.set(name, next); },
      close: () => { closed = true; me.log.push({ op: 'close', t: me.clock.t }); },
    };
  }
  async exists(name: string): Promise<boolean> { return this.data.has(name); }
  async remove(name: string): Promise<void> { this.data.delete(name); }
  async list(): Promise<string[]> { return [...this.data.keys()]; }
  async space(): Promise<{ quota: number; usage: number }> { return { quota: this.free, usage: 0 }; }
}

export class FakeStore implements Store {
  records = new Map<string, DlRecord>();
  meta = new Map<string, unknown>();
  async all(): Promise<DlRecord[]> { return [...this.records.values()]; }
  async put(record: DlRecord): Promise<void> { this.records.set(record.id, structuredClone(record)); }
  async delete(id: string): Promise<void> { this.records.delete(id); }
  async getMeta<T>(key: string): Promise<T | undefined> { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown): Promise<void> { this.meta.set(key, structuredClone(value)); }
}

export interface Override {
  status?: number;
  throw?: boolean; // the fetch itself rejects
  failAfter?: number; // the body stream errors after this many bytes
  stopAfter?: number; // the body stops after this many bytes and never ends
  deliver?: number; // the body ends normally after this many bytes (a short body)
  delayMs?: number; // virtual time before each chunk
  responseDelayMs?: number; // virtual time before the response arrives
  headerEtag?: string; // the ETag header says this, whatever If-Range was matched against
  retryAfter?: string;
  etag?: string;
  startShift?: number; // the Content-Range start is wrong by this much
  totalOverride?: number; // the Content-Range total
}
export interface RuleCtx { n: number; start: number; end: number | null; probe: boolean; now: number }
export interface Spec {
  size: number;
  etag?: string | null; // default '"e1"'
  lastModified?: string | null;
  ranges?: boolean; // default true
  lengthKnown?: boolean; // default true
  mime?: string;
  disposition?: string;
  script?: Override[]; // consumed in order, one per request
  rule?: (c: RuleCtx) => Override | undefined; // consulted when the script is empty
  finalUrl?: string;
}
export interface ReqLog { url: string; range?: string; ifRange?: string; status: number; at: number; open: number }

export class FakeNet implements Net {
  specs = new Map<string, Spec>();
  log: ReqLog[] = [];
  counts = new Map<string, number>();
  produced = 0; // chunks handed out
  consumed: () => number = () => 0; // chunks the consumer has written, set by the test
  maxHeld = 0; // most chunks handed out but not yet written
  inflight = new Map<string, number>(); // open response bodies per host
  maxInflight = new Map<string, number>();
  chunk = 65_536;
  clock: ManualClock;
  constructor(clock: ManualClock) { this.clock = clock; }
  add(url: string, spec: Spec): Spec { this.specs.set(url, spec); return spec; }

  async fetch(url: string, init: { range?: string; ifRange?: string; signal?: AbortSignal }): Promise<NetResponse> {
    const spec = this.specs.get(url);
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    const n = (this.counts.get(url) ?? 0) + 1;
    this.counts.set(url, n);
    const entry: ReqLog = { url, range: init.range, ifRange: init.ifRange, status: 0, at: this.clock.t, open: this.inflight.get(new URL(url).host) ?? 0 };
    this.log.push(entry);
    if (!spec) { entry.status = 404; return this.respond(404, {}, null, url); }
    const m = init.range ? /^bytes=(\d+)-(\d*)$/.exec(init.range) : null;
    const rs = m ? Number(m[1]) : 0;
    const re = m && m[2] !== '' ? Math.min(Number(m[2]), spec.size - 1) : spec.size - 1;
    const probe = init.range === 'bytes=0-0';
    const ov: Override = spec.script?.shift() ?? spec.rule?.({ n, start: rs, end: m && m[2] !== '' ? re : null, probe, now: this.clock.t }) ?? {};
    if (ov.throw) { entry.status = 0; throw new TypeError('Failed to fetch'); }
    if (ov.responseDelayMs) await this.clock.sleep(ov.responseDelayMs, signal);
    const etag = spec.etag === undefined ? '"e1"' : spec.etag;
    const base: Record<string, string> = {};
    if (spec.mime !== undefined) base['content-type'] = spec.mime; else base['content-type'] = 'application/octet-stream';
    if (spec.disposition) base['content-disposition'] = spec.disposition;
    const tag = ov.etag ?? etag;
    if (ov.headerEtag ?? tag) base.etag = (ov.headerEtag ?? tag)!;
    if (spec.lastModified) base['last-modified'] = spec.lastModified;
    if (ov.retryAfter) base['retry-after'] = ov.retryAfter;
    if (ov.status !== undefined && ov.status !== 200 && ov.status !== 206) {
      entry.status = ov.status;
      // a real error response has a body; it stays open until the client closes it
      return this.respond(ov.status, base, this.stream(0, 0, { stopAfter: 0 }, new URL(url).host, signal), spec.finalUrl ?? url);
    }
    const ranged = (spec.ranges ?? true) && m !== null && (!init.ifRange || init.ifRange === tag) && ov.status !== 200;
    let from = 0;
    let to = spec.size - 1;
    let status = 200;
    if (ranged) {
      status = 206; from = rs; to = re;
      base['content-range'] = `bytes ${from + (ov.startShift ?? 0)}-${to}/${spec.lengthKnown === false ? '*' : (ov.totalOverride ?? spec.size)}`;
    } else if (spec.lengthKnown !== false) {
      base['content-length'] = String(spec.size);
    }
    entry.status = status;
    if (status === 206) base['content-length'] = String(to - from + 1);
    return this.respond(status, base, this.stream(from, to, ov, new URL(url).host, signal), spec.finalUrl ?? url);
  }

  private respond(status: number, h: Record<string, string>, body: ReadableStream<Uint8Array> | null, url: string): NetResponse {
    const headers = new Headers(h);
    return { status, url, headers, body };
  }

  private stream(from: number, to: number, ov: Override, host: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
    let pos = from;
    let sent = 0;
    let open = true;
    const limit = ov.deliver ?? Infinity;
    const now = (this.inflight.get(host) ?? 0) + 1;
    this.inflight.set(host, now);
    this.maxInflight.set(host, Math.max(this.maxInflight.get(host) ?? 0, now));
    const end = () => { if (open) { open = false; this.inflight.set(host, this.inflight.get(host)! - 1); } };
    return new ReadableStream<Uint8Array>({
      start: (c) => { signal?.addEventListener('abort', () => { end(); try { c.error(abortError()); } catch { /* closed */ } }, { once: true }); },
      pull: async (c) => {
        if (signal?.aborted) throw abortError();
        if (pos > to || sent >= limit) { end(); c.close(); return; }
        if (ov.stopAfter !== undefined && sent >= ov.stopAfter) await new Promise<void>(() => {});
        if (ov.failAfter !== undefined && sent >= ov.failAfter) { end(); throw new TypeError('network error'); }
        if (ov.delayMs) await this.clock.sleep(ov.delayMs, signal);
        let n = Math.min(this.chunk, to - pos + 1, limit - sent);
        if (ov.stopAfter !== undefined) n = Math.min(n, ov.stopAfter - sent);
        if (ov.failAfter !== undefined) n = Math.min(n, ov.failAfter - sent);
        c.enqueue(pattern(pos, n));
        this.produced++;
        this.maxHeld = Math.max(this.maxHeld, this.produced - this.consumed());
        pos += n; sent += n;
      },
      cancel: () => { end(); },
    }, { highWaterMark: 0 });
  }
}
