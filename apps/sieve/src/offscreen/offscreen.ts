// The engine's host: relays runtime messages to one dedicated Worker (engine-worker.js) and makes blob URLs; no download logic.
// inspected 2026-11-10, Chrome for Testing 149.0.7827.55 (probes p1.mjs and p9.mjs, rerun on that date):
//   F1 an offscreen document and its Worker have chrome.runtime only (no storage, downloads, alarms, tabs);
//   F2 createDocument with reasons WORKERS and BLOBS works, and a second one fails with "Only a single offscreen document may be created.";
//   F3 a WORKERS document stays alive while idle, and a stopped service worker leaves it running;
//   F4 chrome.runtime.getContexts lists it;
//   F5 the Worker has OPFS (createSyncAccessHandle), IndexedDB and navigator.locks; a second sync handle on an open file fails;
//   F7 IndexedDB and OPFS are one store for the worker, this document, its Worker and extension pages;
//   F8 URL.createObjectURL exists here and not in the service worker;
//   F15 a 0.05-minute alarm fired about 3 s later in an unpacked extension (the worker's, not this document's: alarms are undefined here).
import type { SaveReply, WorkerCommand, WorkerMessage, WorkerRequest } from './protocol.ts';

const REPLY_MS = 20_000;
const COMMANDS: Record<string, WorkerCommand> = { 'dl-eng-add': 'add', 'dl-eng-do': 'do', 'dl-eng-config': 'config', 'dl-eng-tick': 'tick', 'dl-eng-save-event': 'save-event' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let worker: Worker;
let generation = 0; // a new Worker is a new generation; late events of an old one are ignored
let ready = false; // the first `config` has completed engine.start()
let nextId = 1;
const pending = new Map<number, (result: unknown) => void>();
const waiting: Array<() => void> = []; // commands held until the engine has started, in order
let latestConfig: unknown = null; // a config that arrived before the engine started: it replaces the one fetched from the worker
const restarts: number[] = [];
let gaveUp = false;

function request(cmd: WorkerCommand, payload: unknown, now = ready): Promise<unknown> {
  return new Promise((resolve) => {
    const id = nextId++;
    const settle = (result: unknown) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => settle({ error: 'TIMEOUT' }), REPLY_MS);
    pending.set(id, settle);
    const post = () => worker.postMessage({ id, cmd, payload } satisfies WorkerRequest);
    if (now) post();
    else waiting.push(() => pending.has(id) && post());
  });
}

function failPending() {
  waiting.length = 0;
  for (const settle of [...pending.values()]) settle({ error: 'TIMEOUT' });
}

async function handshake(): Promise<unknown> {
  for (;;) {
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'dl-sw-ready' });
      if (reply?.settings) return reply.settings;
    } catch {
      // the service worker is still starting
    }
    await sleep(500);
  }
}

function onWorkerMessage(m: WorkerMessage) {
  if ('reply' in m) pending.get(m.reply)?.(m.result);
  else if (m.push === 'state') chrome.runtime.sendMessage({ type: 'dl-state', ...m.payload }).catch(() => {});
  else if (m.push === 'idle') chrome.runtime.sendMessage({ type: 'dl-sw-idle' }).catch(() => {});
  else if (m.push === 'save') {
    const w = worker;
    void prepareSave(m.payload).then((result) => w === worker && w.postMessage({ saveReply: m.req, result } satisfies SaveReply));
  }
}

// One blob URL per record while its save runs; revoked when the save is done or failed, or the worker did not start it.
const blobUrls = new Map<string, string>();

// The blob's type is set because with none Chrome picked .txt for clip.mp4 (the raw-Chrome e2e); a slice still reads from disk.
// The copy needs as much free disk again (the quota follows free space, inspected F6); the file is read from disk by Chrome, nothing is copied into memory (F9).
async function prepareSave({ id, path, size }: { id: string; path: string; size: number | null }): Promise<SaveReply['result']> {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (size !== null && quota - usage < size) return { ok: false, message: 'FILE_NO_SPACE' };
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(`${id}.part`)).getFile();
    if (size !== null && file.size !== size) return { ok: false, message: 'FILE_TOO_SHORT' };
    const blobUrl = blobUrls.get(id) ?? URL.createObjectURL(file.slice(0, file.size, 'application/octet-stream'));
    blobUrls.set(id, blobUrl);
    const reply = await chrome.runtime.sendMessage({ type: 'dl-sw-save', id, blobUrl, path, size: file.size }).catch((e: unknown) => ({ message: (e as Error)?.message ?? e }));
    if (reply?.ok) return { ok: true };
    // No save runs on this URL: an orphan Chrome download from a worker that died before replying must fail, not finish as a second copy.
    URL.revokeObjectURL(blobUrl);
    blobUrls.delete(id);
    return { ok: false, message: String(reply?.message ?? 'NO_REPLY') };
  } catch (e) {
    return { ok: false, message: String((e as Error)?.message ?? e) };
  }
}

function restart() {
  const now = Date.now();
  while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
  if (restarts.length >= 3) {
    generation++;
    worker.terminate();
    failPending();
    if (!gaveUp) console.error('Sieve: the download engine stopped three times in a minute and will not be restarted until this page reloads.');
    gaveUp = true;
    return;
  }
  restarts.push(now);
  void start();
}

async function start() {
  const gen = ++generation;
  ready = false;
  worker?.terminate();
  failPending();
  const w = (worker = new Worker('engine-worker.js'));
  w.onmessage = (e: MessageEvent<WorkerMessage>) => gen === generation && onWorkerMessage(e.data);
  w.onerror = () => gen === generation && restart();
  const fetched = latestConfig ?? (await handshake());
  if (gen !== generation) return;
  const settings = latestConfig ?? fetched;
  latestConfig = null;
  const reply = (await request('config', settings, true)) as { error?: string };
  if (gen !== generation) return;
  if (reply?.error) {
    console.error('Sieve: the download engine did not start:', reply.error);
    return restart();
  }
  ready = true;
  for (const go of waiting.splice(0)) go();
  if (latestConfig) void request('config', latestConfig);
  latestConfig = null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Own properties only ('constructor' and '__proto__' are not commands), and only from the extension's own pages and worker:
  // a content script's sender.url is the web page's.
  if (!sender.url?.startsWith(chrome.runtime.getURL('')) || typeof message?.type !== 'string' || !Object.hasOwn(COMMANDS, message.type)) return false;
  const cmd = COMMANDS[message.type];
  const { type: _type, ...rest } = message;
  if (cmd === 'save-event' && (rest.kind === 'done' || rest.kind === 'failed') && blobUrls.has(rest.id)) {
    URL.revokeObjectURL(blobUrls.get(rest.id)!);
    blobUrls.delete(rest.id);
  }
  if (cmd === 'config' && !ready) {
    latestConfig = rest.settings;
    sendResponse({ ok: true });
    return false;
  }
  const payload = cmd === 'add' ? rest.items : cmd === 'config' ? rest.settings : cmd === 'do' ? { op: rest.op, ids: rest.ids } : cmd === 'save-event' ? rest : undefined;
  request(cmd, payload).then(sendResponse);
  return true;
});

void start();
