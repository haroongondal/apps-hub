import { CATEGORY_IDS } from '@apps-hub/sieve-core/src/dl-settings.ts';
import type { AddItem } from '@apps-hub/sieve-core/src/dl-record.ts';
import { T } from '@apps-hub/sieve-core/src/dl-text.ts';
import { addRecords, fromExtensionPage, sendToEngine } from './engine-link.ts';
import { readDownloads } from './settings-store.ts';

// Pass-through in Task 3.7; Task 3.11 adds config pushes, reconcile, alarms and idle handling.
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
  return added ? { ok: true, ids: added.ids } : { ok: false, message: T.addFailed };
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

function onMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: unknown) => void): boolean {
  if (!isObj(message) || !fromExtensionPage(sender)) return false;
  const handler = message.type === 'dl-add' ? add : message.type === 'dl-do' ? act : message.type === 'dl-sw-ready' ? async () => ({ settings: await readDownloads() }) : null;
  if (!handler) return false;
  handler(message).then(sendResponse, () => sendResponse({ ok: false, message: message.type === 'dl-add' ? T.addFailed : T.actionFailed }));
  return true;
}

export function initRouter(): void {
  chrome.runtime.onMessage.addListener(onMessage);
}
