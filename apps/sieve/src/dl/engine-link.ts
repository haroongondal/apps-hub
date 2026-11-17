import type { AddItem } from '@apps-hub/sieve-core/src/dl-record.ts';
import { dropPendingRules, syncRecordRules } from './net-rules.ts';

export const ENGINE_PAGE = 'offscreen.html';
const ATTEMPTS = 10;
const GAP_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (e: unknown) => String((e as Error)?.message ?? e);

// inspected 2026-11-10, Chrome for Testing 149.0.7827.55: getContexts lists the document (F4); a second createDocument fails (F2).
export async function engineExists(): Promise<boolean> {
  return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
}

let creating: Promise<void> | null = null;
export function ensureEngine(): Promise<void> {
  return (creating ??= (async () => {
    try {
      if (await engineExists()) return;
      await chrome.offscreen.createDocument({
        url: ENGINE_PAGE,
        reasons: ['WORKERS', 'BLOBS'],
        justification: "Downloads files in the background so a download keeps going when Chrome stops the extension's service worker.",
      });
    } catch (e) {
      if (!/Only a single offscreen document may be created/.test(text(e))) throw e;
    }
  })().finally(() => (creating = null)));
}

export async function closeEngine(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // none open
  }
}

// A dropped reply is retried only for an add whose items all carry a chromeId: the engine returns the existing id for the
// same chromeId and url, so a replay cannot make a second row. Any other message could do its work twice.
const replayable = (m: Record<string, unknown>) => m.type === 'dl-eng-add' && Array.isArray(m.items) && m.items.every((i) => typeof (i as AddItem)?.chromeId === 'number');

export async function sendToEngine<T = unknown>(message: { type: `dl-eng-${string}` } & Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await ensureEngine();
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch (e) {
      const retry = /Receiving end does not exist/.test(text(e)) || (replayable(message) && /message port closed before a response was received/.test(text(e)));
      if (!retry || attempt >= ATTEMPTS) throw e;
      await sleep(GAP_MS);
    }
  }
}

// Adds begun and still running: the router must not close the document under one (a dl-sw-idle can race a dl-add or a take-over).
export const adds = { started: 0, running: 0 };

export async function addRecords(items: AddItem[]): Promise<{ ids: string[] } | null> {
  let extras: { url: string; finalUrl?: string; referrer: string }[] = [];
  adds.started++;
  adds.running++;
  try {
    extras = items.map((i) => ({ url: i.url, finalUrl: i.probed?.finalUrl, referrer: i.referrer ?? '' }));
    await syncRecordRules(extras);
    const reply = await sendToEngine<{ ids?: string[] } | undefined>({ type: 'dl-eng-add', items });
    return Array.isArray(reply?.ids) ? { ids: reply.ids } : null;
  } catch {
    return null;
  } finally {
    adds.running--;
    dropPendingRules(extras);
  }
}

// A content script's sender.url is the web page's, so this is true only for the extension's own pages.
export function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}
