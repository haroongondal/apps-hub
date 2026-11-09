import { fetchTransport, loadPublicSuffixList } from 'strongroom-core';
import { UserError, createService } from './service.ts';
import type { Ctx, Pending, Request } from './service.ts';
import { SYNC_URL } from './sync-url.ts';
import { createLocalStore, localKv, migrateAccountKey, sessionKv } from './storage.ts';
import { createDeviceVault, idbKeyStore } from './device-vault.ts';

const AUTO_LOCK_MINUTES = 5;
const SYNC_MINUTES = 5;

const device = createDeviceVault(localKv, idbKeyStore);
const localStore = createLocalStore(device);

const service = createService({
  store: localStore,
  session: sessionKv,
  now: Date.now,
  resetAutoLock: () => void chrome.alarms.create('auto-lock', { delayInMinutes: AUTO_LOCK_MINUTES }),
  syncAlarm: (on) => void (on ? chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES }) : chrome.alarms.clear('sync')),
  sync: SYNC_URL ? { store: localStore, transport: fetchTransport(SYNC_URL) } : undefined,
});

// storage.local is readable from content scripts by default; the ciphertext and header should stay with the extension's own pages.
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// Migration runs once before any message is handled, so a request never races it for the account key.
const ready = Promise.all([
  fetch(chrome.runtime.getURL('public_suffix_list.dat')).then((r) => r.text()).then(loadPublicSuffixList),
  migrateAccountKey(localKv, device),
]);

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'auto-lock') void ready.then(() => service.handle({ type: 'lock' }));
  if (name === 'sync') void ready.then(() => service.handle({ type: 'syncNow' })).catch(() => {});
});

// Chrome clears a tab's badge when the tab navigates, and a sign-in navigates right after the capture, so the badge is set again once the new page has loaded.
async function badgeIfPending(tabId: number): Promise<Pending | null> {
  const pending = (await service.handle({ type: 'pending', tabId })) as Pending | null;
  if (pending) await chrome.action.setBadgeText({ tabId, text: '1' });
  return pending;
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') void ready.then(() => badgeIfPending(tabId));
});

async function announceCapture(tabId: number) {
  if (await badgeIfPending(tabId)) await chrome.action.openPopup().catch(() => {});
}

async function dispatch(message: { type: string; tabId?: number } & Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
  // A web page can never have a chrome-extension:// URL, so the sender's URL tells the popup from a content script.
  const fromPage = !sender.url?.startsWith(chrome.runtime.getURL(''));
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || (fromPage && (tabId === undefined || !sender.url))) throw new UserError("That request isn't allowed.");
  const ctx: Ctx | undefined = fromPage ? { url: sender.url!, tabId: tabId! } : undefined;

  await ready;
  if (message.type === 'openPopup' && fromPage) {
    await chrome.action.openPopup().catch(() => {});
    return null;
  }
  const data = await service.handle(message as Request, ctx);
  if (message.type === 'capture' && fromPage) void announceCapture(tabId!);
  if (message.type === 'resolvePending') await chrome.action.setBadgeText({ tabId: message.tabId, text: '' });
  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dispatch(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => {
      if (!(e instanceof UserError)) console.error('Strongroom request failed:', e?.name);
      sendResponse({ ok: false, error: e instanceof UserError ? e.message : 'Something went wrong. Try again.' });
    },
  );
  return true;
});
