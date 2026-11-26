import { fetchTransport, loadPublicSuffixList } from 'strongroom-core';
import { UserError, createService } from './service.ts';
import type { Ctx, Fingerprint, Pending, Request } from './service.ts';
import { SYNC_URL } from './sync-url.ts';
import { createLocalStore, localKv, migrateAccountKey, sessionKv } from './storage.ts';
import { createDeviceVault, idbKeyStore } from './device-vault.ts';

const AUTO_LOCK_MINUTES = 5;
const SYNC_MINUTES = 5;

const device = createDeviceVault(localKv, idbKeyStore);
const localStore = createLocalStore(device);

// Each fingerprint check is a small window running fingerprint.html; it answers with a fingerprintResult message carrying the nonce in its URL.
type FingerprintResult = { ok: boolean; credentialId?: string; prf?: string };
const FINGERPRINT_TIMEOUT_MS = 60_000;
const waiting = new Map<string, { windowId?: number; finish(r: FingerprintResult | null): void }>();

function fingerprintWindow(query: Record<string, string>): Promise<FingerprintResult | null> {
  const req = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => entry.finish(null), FINGERPRINT_TIMEOUT_MS);
    const entry: { windowId?: number; finish(r: FingerprintResult | null): void } = {
      finish(r) {
        clearTimeout(timer);
        waiting.delete(req);
        // A failed check leaves its window open so the person can read why; a good one closes it.
        if (r?.ok && entry.windowId !== undefined) void chrome.windows.remove(entry.windowId).catch(() => {});
        resolve(r?.ok ? r : null);
      },
    };
    waiting.set(req, entry);
    chrome.windows.create({ url: chrome.runtime.getURL(`fingerprint.html?${new URLSearchParams({ ...query, req })}`), type: 'popup', width: 360, height: 260, focused: true })
      .then((w) => (entry.windowId = w.id), () => entry.finish(null));
  });
}
chrome.windows.onRemoved.addListener((id) => {
  for (const e of waiting.values()) if (e.windowId === id) e.finish(null);
});

// The secret travels between pages as base64, never as a typed array (JSON would turn it into {}); a short or malformed one counts as none.
const prfBytes = (b64?: string) => {
  try {
    const bytes = b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : undefined;
    return bytes && bytes.length >= 32 ? bytes : undefined;
  } catch {
    return undefined;
  }
};
const browserFingerprint: Fingerprint = {
  // Whether this computer has a fingerprint to offer is answered where WebAuthn exists: the popup checks that and disables the toggle with a reason.
  available: async () => true,
  async enroll() {
    const r = await fingerprintWindow({ mode: 'enroll' });
    const prf = prfBytes(r?.prf);
    return r?.credentialId ? { credentialId: r.credentialId, ...(prf && { prf }) } : null;
  },
  async verify(credentialId) {
    const r = await fingerprintWindow({ mode: 'verify', cred: credentialId });
    const prf = prfBytes(r?.prf);
    return r ? { ...(prf && { prf }) } : null;
  },
};

const service = createService({
  store: localStore,
  session: sessionKv,
  settings: localKv,
  now: Date.now,
  resetAutoLock: () => void chrome.alarms.create('auto-lock', { delayInMinutes: AUTO_LOCK_MINUTES }),
  syncAlarm: (on) => void (on ? chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES }) : chrome.alarms.clear('sync')),
  sync: SYNC_URL ? { store: localStore, transport: fetchTransport(SYNC_URL) } : undefined,
  device,
  fingerprint: browserFingerprint,
});

// storage.local is readable from content scripts by default; the ciphertext and header should stay with the extension's own pages.
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// Migration runs once before any message is handled, so a request never races it for the account key.
const ready = Promise.all([
  fetch(chrome.runtime.getURL('public_suffix_list.dat')).then((r) => r.text()).then(loadPublicSuffixList),
  migrateAccountKey(localKv, device),
]);

// The owner rarely opens the popup now that autofill works while locked (Task 8), so the periodic sync alarm is this
// banner's only reliable chance to be seen: it flags the toolbar, same as a captured sign-in does per tab.
async function checkRecoveryBadge() {
  const status = (await service.handle({ type: 'emailRecovery', action: 'status' })) as { pendingRecovery: unknown };
  await chrome.action.setBadgeText({ text: status.pendingRecovery ? '!' : '' });
}

chrome.alarms.onAlarm.addListener(({ name }) => {
  // No `manual: true` here: the auto-lock alarm clears the session only, so autofill and sync keep answering from the device-held keys.
  if (name === 'auto-lock') void ready.then(() => service.handle({ type: 'lock' }));
  if (name === 'sync') void ready.then(() => service.handle({ type: 'syncNow' }).catch(() => {})).then(() => checkRecoveryBadge().catch(() => {}));
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

  // A result is accepted only from the extension's own fingerprint window and only for a check this worker started.
  if (message.type === 'fingerprintResult') {
    const entry = waiting.get(String(message.req));
    if (fromPage || !entry || !sender.url?.startsWith(chrome.runtime.getURL('fingerprint.html'))) throw new UserError("That request isn't allowed.");
    entry.finish(message as unknown as FingerprintResult);
    return null;
  }
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
