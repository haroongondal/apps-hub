// The engine Worker: the real ports (IndexedDB, OPFS, fetch, timers) around the pure engine in sieve-core.
import { createEngine, type Engine, type Host } from '@apps-hub/sieve-core/src/dl-engine.ts';
import type { Clock, Net } from '@apps-hub/sieve-core/src/dl-ports.ts';
import type { AddItem, DoOp, SaveEvent } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { savePath } from '@apps-hub/sieve-core/src/dl-takeover.ts';
import { createTransfer } from '@apps-hub/sieve-core/src/dl-transfer.ts';
import { openStore } from '../dl/idb-store.ts';
import type { SaveReply, WorkerMessage, WorkerRequest } from './protocol.ts';
import { createOpfsFiles } from './opfs-files.ts';

const scope = self as unknown as {
  onmessage: (e: MessageEvent<WorkerRequest | SaveReply>) => void;
  postMessage(m: WorkerMessage): void;
  addEventListener(type: 'online', fn: () => void): void;
  removeEventListener(type: 'online', fn: () => void): void;
};
const post = (m: WorkerMessage) => scope.postMessage(m);

const net: Net = {
  async fetch(url, init) {
    const headers: Record<string, string> = {};
    if (init.range) headers.Range = init.range;
    if (init.ifRange) headers['If-Range'] = init.ifRange;
    const r = await fetch(url, { headers, credentials: 'include', redirect: 'follow', cache: 'no-store', signal: init.signal });
    return { status: r.status, url: r.url, headers: r.headers, body: r.body };
  },
};

const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
const clock: Clock = {
  now: () => Date.now(),
  // Also ends when the browser says it is online again, so a back-off after an outage does not outlast it.
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(aborted());
      const finish = (end: () => void) => () => {
        clearTimeout(timer);
        scope.removeEventListener('online', onOnline);
        signal?.removeEventListener('abort', onAbort);
        end();
      };
      const timer = setTimeout(() => finish(resolve)(), ms);
      const onOnline = finish(resolve);
      const onAbort = finish(() => reject(aborted()));
      scope.addEventListener('online', onOnline);
      signal?.addEventListener('abort', onAbort);
    }),
  every: (ms, fn) => {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
};

let settings: DownloadSettings;
let saveRequests = 0;
const SAVE_REPLY_MS = 30_000;
const saveReplies = new Map<number, (result: SaveReply['result']) => void>();
const host: Host = {
  emit: (payload) => post({ push: 'state', payload }),
  idle: () => post({ push: 'idle' }),
  // Answers when Chrome has been asked (or refused), not before: the offscreen thread replies with `{ saveReply, result }`.
  save(r) {
    const category = settings.categories.find((c) => c.id === r.category) ?? settings.categories[settings.categories.length - 1];
    const req = ++saveRequests;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        saveReplies.delete(req);
        resolve({ ok: false, message: 'TIMEOUT' });
      }, SAVE_REPLY_MS);
      saveReplies.set(req, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      post({ push: 'save', req, payload: { id: r.id, name: r.name, path: savePath(category, r.name), size: r.size } });
    });
  },
};

let release!: (e: Engine) => void;
const engineReady = new Promise<Engine>((resolve) => (release = resolve));
let starting = false;

async function startEngine(first: DownloadSettings): Promise<void> {
  const store = await openStore();
  const files = createOpfsFiles();
  const transfer = createTransfer({ net, files, store, clock });
  const engine = createEngine({ store, files, transfer, clock, host, random: Math.random });
  await engine.start(first);
  release(engine);
}

async function run({ cmd, payload }: WorkerRequest): Promise<unknown> {
  if (cmd === 'config') {
    settings = payload as DownloadSettings;
    if (!starting) {
      starting = true;
      try {
        await startEngine(settings);
      } catch (e) {
        starting = false; // a later config tries again
        throw e;
      }
    } else (await engineReady).config(settings);
    return { ok: true };
  }
  // Every other command waits for the first `config` to finish `start()`, in the order it arrived.
  const engine = await engineReady;
  if (cmd === 'add') return engine.add(payload as AddItem[]);
  if (cmd === 'do') await engine.act((payload as { op: DoOp; ids: string[] }).op, (payload as { op: DoOp; ids: string[] }).ids);
  else if (cmd === 'tick') engine.tick();
  else if (cmd === 'save-event') await engine.saveEvent(payload as SaveEvent);
  return { ok: true };
}

scope.onmessage = async ({ data }) => {
  if ('saveReply' in data) {
    const done = saveReplies.get(data.saveReply);
    saveReplies.delete(data.saveReply);
    done?.(data.result);
    return;
  }
  try {
    post({ reply: data.id, result: await run(data) });
  } catch (e) {
    console.error('Sieve engine: command failed', data.cmd, e);
    const error = e instanceof Error ? e.message : String(e);
    post({ reply: data.id, result: data.cmd === 'add' ? { ids: [], error } : { error } });
  }
};
