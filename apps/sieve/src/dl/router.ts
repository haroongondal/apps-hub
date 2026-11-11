import { CATEGORY_IDS, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import type { AddItem, DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { ALARM_SCHEDULE, ALARM_WATCHDOG, runnable, syncAlarms } from './alarms.ts';
import { addRecords, closeEngine, engineExists, ensureEngine, fromExtensionPage, sendToEngine } from './engine-link.ts';
import { readAllRecords } from './idb-store.ts';
import { dropPendingRules, syncRecordRules } from './net-rules.ts';
import { onDownloadsChanged, readDownloads } from './settings-store.ts';

// The router holds no download state it cannot rebuild: every handler re-reads settings and records, so the worker can die between any two events.
export const io = { records: readAllRecords, syncRules: syncRecordRules, dropRules: dropPendingRules };   // a seam for the unit test
const isHttp = (u: unknown) => {
  try {
    return typeof u === 'string' && /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FIELDS = ['url', 'referrer', 'name', 'category', 'queue', 'source'];

// A page may send only these fields: never `probed` or `chromeId`, and never source 'takeover'.
function cleanItem(i: unknown): AddItem | null {
  if (!isObj(i) || Object.keys(i).some((k) => !FIELDS.includes(k))) return null;
  const { url, referrer, name, category, queue, source } = i;
  if (!isHttp(url) || (source !== 'manual' && source !== 'menu')) return null;
  if (referrer !== undefined && referrer !== '' && !isHttp(referrer)) return null;
  if (name !== undefined && (typeof name !== 'string' || name.length > 300)) return null;
  if (category !== undefined && !(CATEGORY_IDS as readonly unknown[]).includes(category)) return null;
  if (queue !== undefined && (typeof queue !== 'string' || queue.length > 24)) return null;
  return i as unknown as AddItem;
}

async function add(message: Record<string, unknown>): Promise<unknown> {
  const items = Array.isArray(message.items) && message.items.length >= 1 && message.items.length <= 500 ? message.items.map(cleanItem) : null;
  if (!items || items.includes(null)) return { ok: false, message: T.addFailed };
  const added = await addRecords(items as AddItem[]);
  if (!added) return { ok: false, message: T.addFailed };
  void reconcile().catch(logFailure);
  return { ok: true, ids: added.ids };
}

async function act(message: Record<string, unknown>): Promise<unknown> {
  const { op, ids } = message;
  if (!['pause', 'resume', 'remove'].includes(op as string) || !Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== 'string')) return { ok: false, message: T.actionFailed };
  try {
    const reply = await sendToEngine<{ error?: string } | undefined>({ type: 'dl-eng-do', op, ids });
    return reply?.error ? { ok: false, message: T.actionFailed } : { ok: true };
  } catch {
    return { ok: false, message: T.actionFailed };
  }
}

async function idle(): Promise<unknown> {
  const [settings, records] = await Promise.all([readDownloads(), io.records()]);
  if (!runnable(records, settings, new Date())) await closeEngine();
  return { ok: true };
}

const logFailure = (e: unknown) => console.error('Sieve: downloads reconcile failed', e);

// Settings read, record read, session-rule sync, alarm sync, and the engine only when work is runnable. One call at a time.
let chain: Promise<unknown> = Promise.resolve();
export function reconcile(): Promise<void> {
  const run = chain.then(async () => {
    const [settings, records] = await Promise.all([readDownloads(), io.records()]);
    // The engine broadcasts a redirect's final address before it persists it (at the next checkpoint), so the rule comes from the broadcast too.
    const extras = [...seen].flatMap(([id, s]) =>
      s.finalUrl !== s.url && s.referrer !== '' && s.state !== 'done' && records.find((r) => r.id === id)?.finalUrl !== s.finalUrl ? [{ url: s.finalUrl, referrer: s.referrer }] : [],
    );
    try {
      await io.syncRules(extras);
    } finally {
      io.dropRules(extras);
    }
    const at = new Date();
    await syncAlarms(records, settings, at);
    if (runnable(records, settings, at) && !(await engineExists())) await ensureEngine();
  });
  chain = run.catch(() => {});
  return run;
}

// What the last broadcasts said per record: decides whether one is worth a reconcile, and feeds the rule for a not yet persisted redirect target.
const seen = new Map<string, { state: string; url: string; finalUrl: string; referrer: string }>();
let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

function onState(message: Record<string, unknown>): void {
  let stateChanged = false;
  let urlChanged = false;
  for (const r of Array.isArray(message.records) ? (message.records as DlRecord[]) : []) {
    const before = seen.get(r.id);
    if (!before || before.state !== r.state) stateChanged = true;
    // A redirect target needs its own Referer rule before the next request; the rule sync must not wait for the debounce.
    if (before ? before.finalUrl !== r.finalUrl : r.finalUrl !== r.url) urlChanged = true;
    seen.set(r.id, { state: r.state, url: r.url, finalUrl: r.finalUrl, referrer: r.referrer });
  }
  const removed = Array.isArray(message.removed) ? (message.removed as string[]) : [];
  for (const id of removed) seen.delete(id);
  if (urlChanged) void reconcile().catch(logFailure);
  if ((stateChanged || removed.length > 0) && !timer) {
    timer = setTimeout(() => {
      timer = null;
      void reconcile().catch(logFailure);
    }, DEBOUNCE_MS);
  }
}

function onMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: unknown) => void): boolean {
  if (!isObj(message) || !fromExtensionPage(sender)) return false;
  if (message.type === 'dl-state') {
    onState(message);
    return false;
  }
  const handler = message.type === 'dl-add' ? add : message.type === 'dl-do' ? act : message.type === 'dl-sw-idle' ? idle : message.type === 'dl-sw-ready' ? async () => ({ settings: await readDownloads() }) : null;
  if (!handler) return false;
  handler(message).then(sendResponse, () => sendResponse({ ok: false, message: message.type === 'dl-add' ? T.addFailed : T.actionFailed }));
  return true;
}

async function onAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_WATCHDOG && alarm.name !== ALARM_SCHEDULE) return;
  await reconcile();
  // Windows are re-evaluated within a minute even if a schedule alarm was lost.
  if (await engineExists()) await sendToEngine({ type: 'dl-eng-tick' });
}

// A settings change reaches a running engine; it never creates one (reconcile does, when there is work).
async function onSettings(settings: DownloadSettings): Promise<void> {
  if (await engineExists()) await sendToEngine({ type: 'dl-eng-config', settings });
  await reconcile();
}

export function initRouter(): void {
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.alarms.onAlarm.addListener((a) => void onAlarm(a).catch(logFailure));
  onDownloadsChanged((s) => void onSettings(s).catch(logFailure));
  void reconcile().catch(logFailure);
}
