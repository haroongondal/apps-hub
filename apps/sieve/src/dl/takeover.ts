import type { AddItem, DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { factsFromError, factsFromResponse, isOurs, verdict, wantsTakeover, type ChromeItem, type ProbeFacts } from '@apps-hub/sieve-core/src/dl-takeover.ts';
import { PROBE_TIMEOUT_MS } from '@apps-hub/sieve-core/src/dl-transfer.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { addRecords, fromExtensionPage, sendToEngine } from './engine-link.ts';
import { readAllRecords } from './idb-store.ts';
import { addProbeRule } from './net-rules.ts';
import { getDownloads } from './settings-store.ts';

// inspected 2026-11-11, Chrome for Testing 149.0.7827.55 (p3, p5, p13): F11 holds, pause from onCreated settles in ~2 ms with 0 bytes received; cancel 3 ms; erase and resume work.
// shortcut: the API cannot say whether Chrome's request was a POST (it ends as a status or size mismatch and stays with Chrome), and a retry sends no Referer (F13); upgrade if a real case needs either.

export interface AreaLike {                                        // chrome.storage.local or chrome.storage.session
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
export interface TakeoverDeps {
  extensionId: string;
  settings(): Promise<DownloadSettings>;
  pause(id: number): Promise<void>; resume(id: number): Promise<void>; cancel(id: number): Promise<void>; erase(id: number): Promise<void>;
  search(id: number): Promise<{ state: string; paused: boolean; filename: string } | undefined>;
  freeBytes(): Promise<number | null>;                              // quota minus usage from navigator.storage.estimate() (inspected F6), null when unknown
  probe(item: ChromeItem): Promise<ProbeFacts>;                     // never throws
  add(items: AddItem[]): Promise<{ ids: string[] } | null>;         // addRecords
  records(): Promise<DlRecord[]>;                                   // readAllRecords
  remove(ids: string[]): Promise<void>;                             // dl-eng-do remove
  local: AreaLike; session: AreaLike;
  now(): number;
  startedAt: number;
}
export interface RetryDeps {
  records(): Promise<DlRecord[]>;
  download(url: string): Promise<number>;                           // chrome.downloads.download({ url, conflictAction: 'uniquify' })
  search(id: number): Promise<{ state: string; bytesReceived: number } | undefined>;
  remove(ids: string[]): Promise<void>;
  session: AreaLike; now(): number; sleep(ms: number): Promise<void>;
}

const TAKEOVER_PREFIX = 'dlTakeover:';
const RETRY_PREFIX = 'dlRetry:';
const RETRY_TTL_MS = 120_000;
const RETRY_POLLS = 20;
const ignore = () => {};

const entries = async (area: AreaLike, prefix: string): Promise<[string, unknown][]> => Object.entries(await area.get(null)).filter(([k]) => k.startsWith(prefix));

async function heldByEngine(deps: Pick<TakeoverDeps, 'records'>, id: number, url: string, at: number): Promise<string[]> {
  try {
    return (await deps.records()).filter((r) => r.chromeId === id && r.url === url && r.addedAt >= at && r.state !== 'done').map((r) => r.id);
  } catch {
    return [];
  }
}

export async function onCreated(item: chrome.downloads.DownloadItem, deps: TakeoverDeps = realTakeoverDeps()): Promise<void> {
  if (item.incognito) return;
  const retryUrls = (await entries(deps.session, RETRY_PREFIX)).filter(([, until]) => typeof until === 'number' && until > deps.now()).map(([k]) => k.slice(RETRY_PREFIX.length));
  let ci: ChromeItem = { url: item.url, finalUrl: item.finalUrl, referrer: item.referrer, mime: item.mime, totalBytes: item.totalBytes, byExtensionId: item.byExtensionId, filename: item.filename };
  if (isOurs(ci, deps.extensionId, retryUrls)) return;
  const s = await deps.settings();
  if (!wantsTakeover(ci, s.takeOver, s.on).want) return;

  const key = TAKEOVER_PREFIX + item.id;
  const at = deps.now();
  await deps.local.set({ [key]: { at, url: item.url } });
  try {
    await deps.pause(item.id);
  } catch {
    await deps.local.remove(key);
    return;
  }
  let handedOver = false;
  try {
    const cur = await deps.search(item.id);
    ci = { ...ci, filename: cur?.filename ?? '' };
    const v = verdict(ci, await deps.probe(ci), await deps.freeBytes());
    if (!v.take) return;
    try {
      await deps.add([{ url: item.url, referrer: item.referrer, source: 'takeover', chromeId: item.id, probed: { finalUrl: v.finalUrl, size: v.size, mime: v.mime, validator: v.validator, name: v.name } }]);
    } catch {
      // unknown whether the engine stored it: the records decide below
    }
    const ids = await heldByEngine(deps, item.id, item.url, at);
    if (ids.length === 0) return;
    try {
      await deps.cancel(item.id);
    } catch {
      await deps.remove(ids).catch(ignore);
      return;
    }
    handedOver = true;
    await deps.erase(item.id).catch(ignore);
  } finally {
    if (!handedOver) await deps.resume(item.id).catch(ignore);
    await deps.local.remove(key).catch(ignore);
  }
}

export async function recoverPaused(deps: TakeoverDeps = realTakeoverDeps()): Promise<void> {
  for (const [key, entry] of await entries(deps.local, TAKEOVER_PREFIX)) {
    const id = Number(key.slice(TAKEOVER_PREFIX.length));
    const e = entry as { at?: unknown; url?: unknown } | null;
    if (typeof e?.at === 'number' && e.at >= deps.startedAt) continue;
    try {
      if (typeof e?.at === 'number' && typeof e.url === 'string' && (await heldByEngine(deps, id, e.url, e.at)).length > 0) {
        await deps.cancel(id).catch(ignore);
        await deps.erase(id).catch(ignore);
      } else {
        const cur = Number.isInteger(id) ? await deps.search(id) : undefined;
        if (cur && cur.state === 'in_progress' && cur.paused) await deps.resume(id);
      }
    } catch (err) {
      console.error('Sieve: could not recover a paused download', err);
    }
    await deps.local.remove(key).catch(ignore);
  }
}

export async function retryInChrome(id: string, deps: RetryDeps = realRetryDeps()): Promise<{ ok: boolean; message?: string }> {
  const record = (await deps.records()).find((r) => r.id === id);
  if (!record) return { ok: false, message: T.retryGone };
  const keys = [...new Set([record.url, record.finalUrl])].map((u) => RETRY_PREFIX + u);
  await deps.session.set(Object.fromEntries(keys.map((k) => [k, deps.now() + RETRY_TTL_MS])));
  let chromeId: number;
  try {
    chromeId = await deps.download(record.url);
  } catch {
    await deps.session.remove(keys).catch(ignore);
    return { ok: false, message: T.retryRefused };
  }
  for (let i = 0; i < RETRY_POLLS; i++) {
    await deps.sleep(500);
    const cur = await deps.search(chromeId).catch(() => undefined);
    if (cur && (cur.state === 'complete' || (cur.bytesReceived > 0 && !record.saveOnly))) {
      await deps.remove([record.id]).catch(ignore);
      break;
    }
  }
  return { ok: true };
}

export async function realProbe(item: ChromeItem): Promise<ProbeFacts> {
  const releases: (() => Promise<void>)[] = [];
  try {
    for (const url of new Set([item.url, item.finalUrl].filter((u) => u !== ''))) releases.push(await addProbeRule(url, item.referrer));
    const response = await fetch(item.url, { method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'include', redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const facts = factsFromResponse(response);
    void response.body?.cancel().catch(ignore);
    return facts;
  } catch (e) {
    return factsFromError(String((e as Error)?.message ?? e), item.url);
  } finally {
    await Promise.all(releases.map((release) => release().catch(ignore)));
  }
}

const startedAt = Date.now();
function realTakeoverDeps(): TakeoverDeps {
  const d = () => chrome.downloads;
  return {
    extensionId: chrome.runtime.id,
    settings: getDownloads,
    pause: (id) => d().pause(id),
    resume: (id) => d().resume(id),
    cancel: (id) => d().cancel(id),
    erase: async (id) => void (await d().erase({ id })),
    search: async (id) => {
      const [i] = await d().search({ id });
      return i && { state: i.state, paused: i.paused, filename: i.filename };
    },
    freeBytes: async () => {
      const { quota, usage } = await navigator.storage.estimate();
      return typeof quota === 'number' && typeof usage === 'number' ? quota - usage : null;
    },
    probe: realProbe,
    add: addRecords,
    records: readAllRecords,
    remove: async (ids) => void (await sendToEngine({ type: 'dl-eng-do', op: 'remove', ids })),
    local: chrome.storage.local,
    session: chrome.storage.session,
    now: Date.now,
    startedAt,
  };
}

function realRetryDeps(): RetryDeps {
  return {
    records: readAllRecords,
    download: async (url) => chrome.downloads.download({ url, conflictAction: 'uniquify' }),
    search: async (id) => {
      const [i] = await chrome.downloads.search({ id });
      return i && { state: i.state, bytesReceived: i.bytesReceived };
    },
    remove: async (ids) => void (await sendToEngine({ type: 'dl-eng-do', op: 'remove', ids })),
    session: chrome.storage.session,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

export function initTakeover(): void {
  chrome.downloads.onCreated.addListener((item) => {
    onCreated(item).catch((e) => console.error('Sieve: take-over failed', e));
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const m = message as { type?: unknown; id?: unknown } | null;
    if (m?.type !== 'dl-retry-chrome' || !fromExtensionPage(sender)) return false;
    if (typeof m.id !== 'string') {
      sendResponse({ ok: false, message: T.retryGone });
      return false;
    }
    retryInChrome(m.id).then(sendResponse, () => sendResponse({ ok: false, message: T.retryRefused }));
    return true;
  });
  recoverPaused().catch((e) => console.error('Sieve: could not recover paused downloads', e));
}
