import { createEngine } from '../dl-engine.ts';
import type { Engine, StateChange } from '../dl-engine.ts';
import type { Clock, FileHandle, Files, Store, Transfer, TransferHooks, TransferResult } from '../dl-ports.ts';
import { partName } from '../dl-record.ts';
import type { DlRecord } from '../dl-record.ts';
import { DEFAULT_DOWNLOADS } from '../dl-settings.ts';
import type { DownloadSettings } from '../dl-settings.ts';

export const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

export function settingsWith(over: Partial<DownloadSettings> = {}, maxParallel = 3): DownloadSettings {
  const s = structuredClone(DEFAULT_DOWNLOADS) as DownloadSettings;
  s.queues[0].maxParallel = maxParallel;
  return { ...s, ...over };
}

/** A full record literal, so the engine tests do not depend on newRecord. */
export function rec(id: string, over: Partial<DlRecord> = {}): DlRecord {
  return {
    id, url: `https://example.com/${id}.zip`, finalUrl: `https://example.com/${id}.zip`, referrer: '', name: `${id}.zip`,
    category: 'archives', categoryFixed: false, queue: 'main', state: 'queued', force: false, size: null, rangeOk: false,
    validator: null, mime: '', parts: [], partsWanted: 1, addedAt: 1, startedAt: null, finishedAt: null, error: null,
    saveOnly: false, savedPath: null, savedId: null, chromeId: null, source: 'manual', ...over,
  };
}

export interface FakeStore extends Store {
  rows: Map<string, DlRecord>;
  meta: Map<string, unknown>;
  puts: { record: DlRecord; strict: boolean }[];
  deleted: string[];
  /** Puts wait until the returned function is called. */
  hold(): () => void;
}
export function fakeStore(initial: DlRecord[] = []): FakeStore {
  let gate: Promise<void> | null = null;
  const s: FakeStore = {
    rows: new Map(initial.map((r) => [r.id, structuredClone(r)])),
    meta: new Map(),
    puts: [],
    deleted: [],
    hold() {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
    async all() {
      return [...s.rows.values()].map((r) => structuredClone(r));
    },
    async put(record, options) {
      if (gate) await gate;
      s.puts.push({ record: structuredClone(record), strict: options?.strict === true });
      s.rows.set(record.id, structuredClone(record));
    },
    async delete(id) {
      s.rows.delete(id);
      s.deleted.push(id);
    },
    async getMeta<T>(key: string) {
      return s.meta.get(key) as T | undefined;
    },
    async setMeta(key, value) {
      s.meta.set(key, value);
    },
  };
  return s;
}

export interface FakeFiles extends Files {
  map: Map<string, Uint8Array>;
  free: { quota: number; usage: number };
  removed: string[];
  /** space() waits until the returned function is called. */
  holdSpace(): () => void;
}
export function fakeFiles(names: string[] = []): FakeFiles {
  let gate: Promise<void> | null = null;
  const f: FakeFiles = {
    map: new Map(names.map((n) => [n, new Uint8Array(0)])),
    free: { quota: 1e12, usage: 0 },
    removed: [],
    holdSpace() {
      let open!: () => void;
      gate = new Promise<void>((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
    async open(name, length) {
      const had = f.map.get(name);
      const cur = had ?? new Uint8Array(0);
      const bytes = length === null ? cur : new Uint8Array(length);
      f.map.set(name, bytes);
      const h: FileHandle = { existingSize: had?.length ?? null, write() {}, flush() {}, size: () => bytes.length, truncate() {}, close() {} };
      return h;
    },
    async exists(name) {
      return f.map.has(name);
    },
    async remove(name) {
      f.removed.push(name);
      f.map.delete(name);
    },
    async list() {
      return [...f.map.keys()];
    },
    async space() {
      if (gate) await gate;
      return { ...f.free };
    },
  };
  return f;
}

export interface FakeClock extends Clock {
  t: number;
  advance(ms: number): Promise<void>;
}
export function fakeClock(start = 1_700_000_000_000): FakeClock {
  type Timer = { at: number; fire(): void; period?: number; dead?: boolean };
  const timers = new Set<Timer>();
  const c: FakeClock = {
    t: start,
    now: () => c.t,
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
        const timer: Timer = { at: c.t + ms, fire: () => (signal?.removeEventListener('abort', onAbort), resolve()) };
        const onAbort = () => {
          timers.delete(timer);
          reject(new DOMException('aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        timers.add(timer);
      });
    },
    every(ms, fn) {
      const timer: Timer = { at: c.t + ms, period: ms, fire: fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    async advance(ms) {
      const end = c.t + ms;
      for (;;) {
        const due = [...timers].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        c.t = due.at;
        if (due.period) due.at += due.period;
        else timers.delete(due);
        due.fire();
        await flush(2);
      }
      c.t = end;
      await flush(2);
    },
  };
  return c;
}

export interface FakeRun {
  record: DlRecord;
  signal: AbortSignal;
  hooks: TransferHooks;
  settled: boolean;
  finish(result: TransferResult): void;
  done(patch?: Partial<DlRecord>): void;
  fail(error: string, patch?: Partial<DlRecord>): void;
}
export interface FakeTransfer extends Transfer {
  runs: FakeRun[];
  configs: DownloadSettings[];
  /** The record ids in the order their transfers started. */
  started(): string[];
  /** The latest run of a record. */
  of(id: string): FakeRun;
}
/** run() settles `paused` when its signal aborts, unless the test settled it first. */
export function fakeTransfer(): FakeTransfer {
  const t: FakeTransfer = {
    runs: [],
    configs: [],
    started: () => t.runs.map((r) => r.record.id),
    of(id) {
      const r = [...t.runs].reverse().find((x) => x.record.id === id);
      if (!r) throw new Error(`no transfer for ${id}`);
      return r;
    },
    config(s) {
      t.configs.push(s);
    },
    run(record, signal, hooks) {
      return new Promise<TransferResult>((resolve) => {
        const run: FakeRun = {
          record, signal, hooks, settled: false,
          finish(result) {
            if (run.settled) return;
            run.settled = true;
            resolve(result);
          },
          done(patch = {}) {
            const size = record.size ?? 100;
            const parts = patch.parts ?? [{ start: 0, end: size - 1, done: size }];
            run.finish({ kind: 'done', record: { ...record, parts, ...patch } });
          },
          fail(error, patch = {}) {
            run.finish({ kind: 'failed', record: { ...record, error, ...patch }, error });
          },
        };
        signal.addEventListener('abort', () => run.finish({ kind: 'paused', record: run.record }), { once: true });
        t.runs.push(run);
      });
    },
  };
  return t;
}

export interface FakeHost {
  changes: StateChange[];
  saves: DlRecord[];
  idles: number;
  saveAnswer: { ok: true } | { ok: false; message: string };
  emit(c: StateChange): void;
  save(r: DlRecord): Promise<{ ok: true } | { ok: false; message: string }>;
  idle(): void;
}
export function fakeHost(): FakeHost {
  const h: FakeHost = {
    changes: [], saves: [], idles: 0, saveAnswer: { ok: true },
    emit: (c) => void h.changes.push(c),
    save: async (r) => (h.saves.push(r), h.saveAnswer),
    idle: () => void h.idles++,
  };
  return h;
}

export interface Rig {
  engine: Engine;
  store: FakeStore;
  files: FakeFiles;
  clock: FakeClock;
  transfer: FakeTransfer;
  host: FakeHost;
  settings: DownloadSettings;
  state(id: string): string | undefined;
  /** The stored copy of a record. */
  stored(id: string): DlRecord | undefined;
}
export async function makeRig(opts: { settings?: DownloadSettings; records?: DlRecord[]; files?: string[]; random?: () => number; noStart?: boolean } = {}): Promise<Rig> {
  const store = fakeStore(opts.records);
  const files = fakeFiles(opts.files);
  // a listed part file is as long as its record says, so the copy looks whole
  for (const n of opts.files ?? []) {
    const size = (opts.records ?? []).find((r) => partName(r.id) === n)?.size;
    if (size) files.map.set(n, new Uint8Array(size));
  }
  const clock = fakeClock();
  const transfer = fakeTransfer();
  const host = fakeHost();
  const settings = opts.settings ?? settingsWith();
  const engine = createEngine({ store, files, transfer, clock, host, random: opts.random ?? Math.random });
  const rig: Rig = { engine, store, files, clock, transfer, host, settings, state: (id) => engine.records().find((r) => r.id === id)?.state, stored: (id) => store.rows.get(id) };
  if (!opts.noStart) {
    await engine.start(settings);
    await flush();
  }
  return rig;
}
