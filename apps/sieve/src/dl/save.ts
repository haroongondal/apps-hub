// Finishing (the protocol in the plan's "The finishing protocol"): the offscreen document sends `dl-sw-save` with a blob URL of the private copy,
// this worker saves it with chrome.downloads and tells the engine what happened. Entries are one session key each: `dlSave:<blobUrl>`.
// inspected 2026-11-10, Chrome for Testing 149.0.7827.55 (probes p2.mjs and p8.mjs, F9 and F10): a blob URL download from the worker saved a
// 2.5 GiB OPFS file with fileSize equal to the file and no memory growth; `onCreated` for it has no byExtensionId (a `search` afterwards does).
import { sendToEngine, fromExtensionPage } from './engine-link.ts';

export interface SaveEntry { id: string; size: number; path: string; chromeId: number | null; state: 'pending' | 'complete' | 'interrupted'; filename: string | null; error: string | null }
type Reply = { ok: true; chromeId: number } | { ok: false; message: string };
type Event = { id: string; kind: 'path'; filename: string; chromeId: number } | { id: string; kind: 'done'; filename: string; chromeId: number } | { id: string; kind: 'failed'; error: string };

const PREFIX = 'dlSave:';
const INVALID: Reply = { ok: false, message: 'INVALID' };
const inflight = new Map<string, Promise<Reply>>(); // a replayed message while the first is starting must not start a second download
const text = (e: unknown) => String((e as Error)?.message ?? e);

async function entries(): Promise<[string, SaveEntry][]> {
  return Object.entries(await chrome.storage.session.get(null)).filter(([k]) => k.startsWith(PREFIX)) as [string, SaveEntry][];
}

function valid(m: Record<string, unknown>): boolean {
  const { id, blobUrl, path, size } = m;
  return (
    typeof id === 'string' && id !== '' &&
    typeof blobUrl === 'string' && blobUrl.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`) &&
    typeof path === 'string' && path !== '' && path.length <= 400 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') &&
    typeof size === 'number' && Number.isFinite(size) && size >= 0
  );
}

export async function onSave(message: unknown, sender: chrome.runtime.MessageSender): Promise<Reply> {
  const m = message as Record<string, unknown> | null;
  if (typeof m !== 'object' || m === null || !fromExtensionPage(sender) || !sender.url?.endsWith('/offscreen.html') || !valid(m)) return INVALID;
  const { id, blobUrl, path, size } = m as { id: string; blobUrl: string; path: string; size: number };
  const running = inflight.get(id);
  if (running) return running;
  const job = start(id, blobUrl, path, size).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

async function start(id: string, blobUrl: string, path: string, size: number): Promise<Reply> {
  const key = PREFIX + blobUrl;
  try {
    // One save per record: a Chrome item that is running or finished is the save.
    for (const [k, e] of await entries()) {
      if (e.id !== id) continue;
      if (e.chromeId !== null) {
        const [item] = await chrome.downloads.search({ id: e.chromeId });
        if (item && (item.state === 'in_progress' || item.state === 'complete')) return { ok: true, chromeId: e.chromeId };
      }
      await chrome.storage.session.remove(k); // a dead earlier attempt must not report a failure for this one
    }
    const entry: SaveEntry = { id, size, path, chromeId: null, state: 'pending', filename: null, error: null };
    await chrome.storage.session.set({ [key]: entry });
    let chromeId: number;
    try {
      chromeId = await chrome.downloads.download({ url: blobUrl, filename: path, conflictAction: 'uniquify' });
    } catch (e) {
      await chrome.storage.session.remove(key);
      return { ok: false, message: text(e) };
    }
    if (key in (await chrome.storage.session.get(key))) await chrome.storage.session.set({ [key]: { ...entry, chromeId } }); // not when a fast finish already removed it
    return { ok: true, chromeId };
  } catch (e) {
    return { ok: false, message: text(e) };
  }
}

// Sends events in order; a terminal one removes the entry only once the engine has answered.
async function report(key: string, events: Event[]): Promise<void> {
  try {
    for (const event of events) {
      const reply = await sendToEngine<{ error?: string } | undefined>({ type: 'dl-eng-save-event', ...event });
      if (reply?.error) return;
      if (event.kind !== 'path') await chrome.storage.session.remove(key);
    }
  } catch {
    // the entry stays; recoverSaves sends it again at the next worker start
  }
}

function terminal(entry: SaveEntry, item: chrome.downloads.DownloadItem): Event[] {
  if (item.state === 'complete') {
    return item.fileSize === entry.size ? [{ id: entry.id, kind: 'done', filename: item.filename, chromeId: item.id }] : [{ id: entry.id, kind: 'failed', error: 'FILE_SIZE_MISMATCH' }];
  }
  return item.state === 'interrupted' ? [{ id: entry.id, kind: 'failed', error: item.error ?? 'INTERRUPTED' }] : [];
}

async function onChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
  if (!delta.filename && !delta.state) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  const key = PREFIX + item.url;
  const entry = (await chrome.storage.session.get(key))[key] as SaveEntry | undefined;
  if (!entry) return;
  const events: Event[] = [];
  if (delta.filename?.current) events.push({ id: entry.id, kind: 'path', filename: delta.filename.current, chromeId: item.id });
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') events.push(...terminal(entry, item));
  await report(key, events);
}

export async function recoverSaves(): Promise<void> {
  for (const [key, entry] of await entries()) {
    if (inflight.has(entry.id)) continue; // onSave is still starting this one
    try {
      let chromeId = entry.chromeId;
      if (chromeId === null) {
        // the worker died between writing the entry and the reply to download()
        const [found] = await chrome.downloads.search({ url: key.slice(PREFIX.length) });
        if (!found) {
          await report(key, [{ id: entry.id, kind: 'failed', error: 'NOT_STARTED' }]);
          continue;
        }
        chromeId = found.id;
        await chrome.storage.session.set({ [key]: { ...entry, chromeId } });
      }
      const [item] = await chrome.downloads.search({ id: chromeId });
      if (!item) await report(key, [{ id: entry.id, kind: 'failed', error: 'INTERRUPTED' }]);
      else await report(key, terminal(entry, item));
    } catch {
      // this entry stays for the next start
    }
  }
}

export function initSave(): void {
  chrome.downloads.onChanged.addListener((delta) => void onChanged(delta).catch(() => {}));
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'dl-sw-save') return false;
    onSave(message, sender).then(sendResponse, () => sendResponse(INVALID));
    return true;
  });
  void recoverSaves().catch(() => {}); // a worker that died mid-save: send what Chrome finished meanwhile
}
