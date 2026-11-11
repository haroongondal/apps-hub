import { addBytes, makeMeter, rate } from './dl-bucket.ts';
import type { Meter } from './dl-bucket.ts';
import type { Clock, Files, Store, Transfer, TransferResult } from './dl-ports.ts';
import { applyEvent, bytesDone, ERRORS, isComplete, newId, newRecord, partName } from './dl-record.ts';
import type { AddItem, DlRecord, DoOp, SaveEvent } from './dl-record.ts';
import { schedulePlan } from './dl-queue.ts';
import { CATEGORY_IDS } from './dl-settings.ts';
import type { DownloadSettings } from './dl-settings.ts';
import { categoryOf, chooseName, sanitizeFileName, SPACE_MARGIN } from './dl-takeover.ts';

export const IDLE_MS = 60_000; // nothing to do for this long: ask the worker to close the document
export const EMIT_MS = 250; // at most four state broadcasts a second

export interface StateChange {
  records: DlRecord[];
  removed: string[];
  speeds: Record<string, number>;
  total: number;
}

export interface Host {
  emit(change: StateChange): void;
  save(r: DlRecord): Promise<{ ok: true } | { ok: false; message: string }>; // hand the finished private copy to the worker (Task 3.12); ok means "Chrome has been asked"
  idle(): void;
}

export interface EngineDeps {
  store: Store;
  files: Files;
  transfer: Transfer;
  clock: Clock;
  host: Host;
  random(): number;
}

export interface Engine {
  start(settings: DownloadSettings): Promise<void>;
  config(settings: DownloadSettings): void;
  add(items: AddItem[]): Promise<{ ids: string[] }>; // resolves after every new record is persisted
  act(op: DoOp, ids: string[]): Promise<void>;
  saveEvent(e: SaveEvent): Promise<void>;
  tick(): void; // re-evaluate queue windows now
  stop(): Promise<void>; // abort transfers without changing any record (for tests and shutdown)
  records(): DlRecord[];
}

type Settled = TransferResult | { kind: 'threw'; error: unknown };
interface Run { controller: AbortController; reason: string; finished: Promise<Settled> }

const copy = (r: DlRecord): DlRecord => ({ ...r, parts: r.parts.map((p) => ({ ...p })) });
const log = (e: unknown) => console.error('sieve engine:', e);
const PART_FILE = /^d[a-z0-9]+\.part$/;

export function createEngine(deps: EngineDeps): Engine {
  const { store, files, transfer, clock, host, random } = deps;
  let settings: DownloadSettings | null = null;
  let stopped = false;
  const recs = new Map<string, DlRecord>();
  const runs = new Map<string, Run>();
  const starting = new Set<string>(); // queued records whose start is waiting on an await
  const meters = new Map<string, Meter>();
  const dirty = new Set<string>();
  let removed: string[] = [];
  let sentSpeed = false;
  let cancelEmit: (() => void) | null = null;
  let idleCtl: AbortController | null = null;

  // every public mutation and every settle handler runs here, one after another
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = tail.then(fn);
    tail = p.catch(() => {});
    return p;
  }
  const background = (fn: () => Promise<unknown> | unknown) => void enqueue(fn).catch(log);

  const persist = (r: DlRecord) => (r.source === 'takeover' ? store.put(r, { strict: true }) : store.put(r));
  function set(r: DlRecord): void {
    recs.set(r.id, r);
    dirty.add(r.id);
  }

  function cancelIdle(): void {
    idleCtl?.abort();
    idleCtl = null;
  }
  function armIdle(): void {
    if (idleCtl) return;
    const ctl = (idleCtl = new AbortController());
    clock.sleep(IDLE_MS, ctl.signal).then(
      () => {
        if (idleCtl !== ctl) return;
        idleCtl = null;
        if (stopped || !settings) return;
        if (isIdle(planNow())) host.idle();
      },
      () => {},
    );
  }
  const isIdle = (plan: { start: string[] }) =>
    plan.start.length === 0 && !starting.size && ![...recs.values()].some((r) => r.state === 'running' || r.state === 'saving');

  function planNow() {
    // a record whose start waits on an await counts as running for the slot arithmetic
    const view = [...recs.values()].map((r) => (starting.has(r.id) ? { ...r, state: 'running' as const } : r));
    return schedulePlan(view, settings!.queues, new Date(clock.now()), settings!.on);
  }

  function reconcile(): void {
    if (!settings || stopped) return;
    const plan = planNow();
    for (const id of plan.stop) {
      const run = runs.get(id);
      if (run) {
        if (!run.controller.signal.aborted) {
          run.reason = 'stop';
          run.controller.abort('stop');
        }
      } else starting.delete(id);
    }
    for (const id of plan.start) {
      if (!runs.has(id) && !starting.has(id) && recs.get(id)?.state === 'queued') startRecord(id).catch(log);
    }
    if (isIdle(plan)) armIdle();
    else cancelIdle();
  }

  async function startRecord(id: string): Promise<void> {
    starting.add(id);
    let phase: 'space' | 'start' = 'space';
    try {
      const ok = () => starting.has(id) && !stopped && recs.get(id)?.state === 'queued';
      let r = recs.get(id)!;
      if (r.size !== null) {
        const { quota, usage } = await files.space();
        if (!ok()) return;
        r = recs.get(id)!;
        if (quota - usage < r.size! - bytesDone(r) + SPACE_MARGIN) {
          const failed = applyEvent(r, 'fail', clock.now(), { error: ERRORS.space });
          set(failed);
          await persist(failed);
          return;
        }
      }
      phase = 'start';
      await persist(applyEvent(r, 'start', clock.now()));
      if (!ok()) return;
      const rec = applyEvent(recs.get(id)!, 'start', clock.now());
      set(rec);
      const run: Run = { controller: new AbortController(), reason: '', finished: undefined as unknown as Promise<Settled> };
      meters.set(id, makeMeter(clock.now()));
      const current = () => runs.get(id) === run && recs.has(id);
      runs.set(id, run);
      run.finished = (async () => transfer.run(rec, run.controller.signal, {
        persist: async (record) => {
          if (!current()) return;
          set(record);
          await persist(record);
        },
        update: (record) => {
          if (current()) set(record);
        },
        bytes: (n) => {
          const m = meters.get(id);
          if (m && current()) addBytes(m, n, clock.now());
        },
      }))().then((res): Settled => res, (error): Settled => ({ kind: 'threw', error }));
      cancelIdle();
      void run.finished.then((res) => background(() => settle(id, run, res)));
    } catch (e) {
      // a throwing disk or store must not leave the record queued: the reconcile below would retry it forever
      log(e);
      const cur = recs.get(id);
      if (cur?.state === 'queued') {
        const failed = applyEvent(cur, 'fail', clock.now(), { error: phase === 'space' ? ERRORS.unknown : ERRORS.storage });
        set(failed);
        try {
          await persist(failed);
        } catch (e2) {
          log(e2);
        }
      }
    } finally {
      starting.delete(id);
      if (!runs.has(id)) background(reconcile); // the slot this start held is free again
    }
  }

  async function settle(id: string, run: Run, res: Settled): Promise<void> {
    const r = recs.get(id);
    if (!r || runs.get(id) !== run) return; // removed meanwhile
    runs.delete(id);
    meters.delete(id);
    const now = clock.now();
    if (res.kind === 'threw') {
      log(res.error);
      const f = applyEvent(r, 'fail', now, { error: ERRORS.unknown });
      set(f);
      await persist(f);
    } else if (res.kind === 'failed') {
      const f = applyEvent({ ...res.record, state: 'running' }, 'fail', now, { error: res.error });
      set(f);
      await persist(f);
    } else if (res.kind === 'paused') {
      const base = { ...res.record, state: 'running' as const };
      if (run.reason === 'remove' || run.reason === 'shutdown') return;
      const next = applyEvent(base, run.reason === 'stop' ? 'stop' : 'pause', now);
      set(next);
      await persist(next);
    } else {
      const base = { ...res.record, state: 'running' as const };
      // the file is pre-sized and sparse, so only the parts say whether every byte arrived
      const next = isComplete(base) ? applyEvent(base, 'partsDone', now) : applyEvent(base, 'fail', now, { error: ERRORS.length });
      set(next);
      await persist(next);
      if (next.state === 'saving') save(id);
    }
    reconcile();
  }

  // fire and forget: a slow worker must not hold the queue
  function save(id: string): void {
    const r = recs.get(id);
    if (!r) return;
    cancelIdle();
    host
      .save(copy(r))
      .then((res) => res, (e): { ok: false; message: string } => ({ ok: false, message: String((e as Error)?.message ?? e) }))
      .then((res) => {
        if (res.ok) return;
        background(async () => {
          const cur = recs.get(id);
          if (cur?.state !== 'saving') return;
          const next = applyEvent(cur, 'saveFailed', clock.now(), { error: ERRORS.save(res.message) });
          set(next);
          try {
            await persist(next);
          } finally {
            reconcile(); // the failed save may leave the engine idle
          }
        });
      });
  }

  function emit(): void {
    const speeds: Record<string, number> = {};
    let total = 0;
    for (const [id, m] of meters) {
      const v = rate(m, clock.now());
      if (v > 0) {
        speeds[id] = v;
        total += v;
      }
    }
    const moving = total > 0;
    if (!dirty.size && !removed.length && !moving && !sentSpeed) return;
    sentSpeed = moving;
    const records = [...dirty].flatMap((id) => (recs.has(id) ? [copy(recs.get(id)!)] : []));
    const gone = removed;
    dirty.clear();
    removed = [];
    host.emit({ records, removed: gone, speeds, total });
  }

  async function addItems(items: AddItem[]): Promise<{ ids: string[] }> {
    const s = settings;
    if (!s) throw new Error('engine not started');
    const ids: string[] = [];
    for (const item of items) {
      let url: URL;
      try {
        url = new URL(item.url);
      } catch {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (item.chromeId != null) {
        const same = [...recs.values()].find((r) => r.chromeId === item.chromeId && r.url === item.url && r.state !== 'done');
        if (same) {
          ids.push(same.id);
          continue;
        }
      }
      const name = item.probed?.name ?? (item.name ? sanitizeFileName(item.name) : chooseName({ disposition: null, url: item.url, mime: '' }));
      const fixed = item.category !== undefined && (CATEGORY_IDS as readonly string[]).includes(item.category);
      const now = clock.now();
      let k = 0;
      let id = newId(now, random);
      while (recs.has(id)) id = newId(now + ++k, random); // a constant random and a frozen clock must still end
      let rec = newRecord(
        {
          url: item.url,
          referrer: item.referrer ?? '',
          name,
          category: fixed ? item.category! : categoryOf(name, item.probed?.mime ?? '', s.categories),
          categoryFixed: fixed,
          queue: s.queues.some((q) => q.id === item.queue) ? item.queue! : s.queues[0].id,
          source: item.source,
          partsWanted: s.parts,
          chromeId: item.chromeId ?? null,
          ...(item.probed && { finalUrl: item.probed.finalUrl, size: item.probed.size, mime: item.probed.mime, validator: item.probed.validator, rangeOk: true }),
        },
        now,
        id,
      );
      // Chrome's download is already cancelled by the time a closed window or a full queue could park it
      if (item.source === 'takeover') rec = { ...rec, force: true };
      await persist(rec);
      set(rec);
      ids.push(id);
    }
    cancelIdle();
    reconcile();
    return { ids };
  }

  // A finished or save-only record goes straight to saving, so its copy must still be whole: a lost or short one is downloaded again from the cut.
  async function recopy(r: DlRecord): Promise<DlRecord> {
    if (!(r.saveOnly || isComplete(r))) return r;
    let have = 0;
    if (await files.exists(partName(r.id))) {
      try {
        const h = await files.open(partName(r.id), null);
        have = h.size();
        h.close();
      } catch { return r; } // busy: the save that holds it will say what is wrong
    }
    if (have >= (r.size ?? 1)) return r;
    return { ...r, saveOnly: false, parts: r.parts.map((p) => ({ ...p, done: Math.max(0, Math.min(p.done, have - p.start)) })) };
  }

  async function act(op: DoOp, ids: string[]): Promise<void> {
    for (const id of ids) {
      const r = recs.get(id);
      if (!r) continue;
      const now = clock.now();
      if (op === 'pause') {
        const run = runs.get(id);
        if (run && r.state === 'running') {
          run.reason = 'pause';
          run.controller.abort('pause');
        } else if (r.state === 'queued') {
          const next = applyEvent(r, 'pause', now);
          set(next);
          await persist(next);
        }
      } else if (op === 'resume') {
        if (r.state === 'paused' || r.state === 'failed') {
          const next = applyEvent(await recopy(r), 'resume', now);
          set(next);
          await persist(next);
          if (next.state === 'saving') save(id);
        } else if (r.state === 'queued') {
          const next = { ...r, force: true };
          set(next);
          await persist(next);
        }
        cancelIdle();
      } else {
        if (r.state === 'saving') continue; // host.save is streaming the only copy; a failed or cancelled save leaves 'failed', which can be removed
        const run = runs.get(id);
        if (run) {
          run.reason = 'remove';
          run.controller.abort('remove');
          await run.finished; // the transfer's own promise: its settle handler is queued behind this task
          runs.delete(id);
        }
        starting.delete(id);
        meters.delete(id);
        await files.remove(partName(id));
        await store.delete(id);
        recs.delete(id);
        dirty.delete(id);
        removed.push(id);
      }
    }
    reconcile();
  }

  return {
    start(s) {
      return enqueue(async () => {
        stopped = false;
        settings = s;
        transfer.config(s);
        recs.clear();
        for (const r of await store.all()) recs.set(r.id, r);
        for (const r of [...recs.values()]) {
          if (r.state === 'running') {
            const next = applyEvent(r, 'restart', clock.now());
            recs.set(r.id, next);
            await persist(next);
          }
        }
        for (const r of recs.values()) {
          if (r.state === 'saving') save(r.id);
          else if (r.state === 'done') await files.remove(partName(r.id));
        }
        for (const name of await files.list()) {
          if (PART_FILE.test(name) && !recs.has(name.slice(0, -'.part'.length))) await files.remove(name);
        }
        cancelEmit?.();
        cancelEmit = clock.every(EMIT_MS, emit);
        background(reconcile);
      });
    },
    config(s) {
      background(() => {
        settings = s;
        transfer.config(s);
        reconcile();
      });
    },
    add: (items) => enqueue(() => addItems(items)),
    act: (op, ids) => enqueue(() => act(op, ids)),
    saveEvent: (e) =>
      enqueue(async () => {
        const r = recs.get(e.id);
        if (!r) return;
        let next = r;
        if (e.kind === 'path') next = { ...r, savedPath: e.filename, savedId: e.chromeId };
        else if (r.state !== 'saving') return;
        else if (e.kind === 'done') next = applyEvent({ ...r, savedPath: e.filename, savedId: e.chromeId }, 'saved', clock.now());
        else next = applyEvent(r, 'saveFailed', clock.now(), { error: ERRORS.save(e.error) });
        set(next);
        await persist(next);
        if (e.kind === 'done') await files.remove(partName(e.id));
        reconcile(); // a finished save may leave the engine idle
      }),
    tick: () => background(reconcile),
    async stop() {
      stopped = true;
      cancelEmit?.();
      cancelEmit = null;
      cancelIdle();
      const all = [...runs.values()];
      for (const run of all) {
        run.reason = 'shutdown';
        run.controller.abort('shutdown');
      }
      await Promise.all(all.map((r) => r.finished));
      await tail;
    },
    records: () => [...recs.values()].map(copy),
  };
}
