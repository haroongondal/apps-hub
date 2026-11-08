// Deep imports keep the filter compiler out of the worker bundle: a picked item is stored as text and as plain data, with no recompile.
import { storedCosmetic } from '@apps-hub/sieve-core/src/page.ts';
import { addHideFilter, parsePick, type Pick } from '@apps-hub/sieve-core/src/picker.ts';
import { validateSettings } from '@apps-hub/sieve-core/src/settings.ts';
import { withSettingsLock } from './lock.ts';

const store = ({ host, selector }: Pick): Promise<void> =>
  withSettingsLock(async () => {
    const { settings, myCosmetic } = await chrome.storage.local.get(['settings', 'myCosmetic']);
    const s = validateSettings(settings);
    const mine = storedCosmetic(myCosmetic);
    const had = Object.hasOwn(mine.hide, host) ? mine.hide[host] : [];
    await chrome.storage.local.set({
      settings: { ...s, blocking: { ...s.blocking, myFilters: addHideFilter(s.blocking.myFilters, host, selector) } },
      myCosmetic: { ...mine, hide: { ...mine.hide, [host]: had.includes(selector) ? had : [...had, selector] } },
    });
  });

export function onMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: { ok: boolean }) => void): boolean {
  if ((message as { type?: unknown } | null)?.type !== 'pick') return false;
  const pick = parsePick(message, sender.url);
  if (pick === null || sender.tab?.id === undefined || sender.documentId === undefined) {
    respond({ ok: false });
    return false;
  }
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  // store() takes the settings lock, so two quick picks, or a pick during a save, never undo each other.
  store(pick)
    .then(() => chrome.scripting.insertCSS({ target, css: `${pick.selector}{display:none!important}`, origin: 'USER' }))
    .then(
      () => respond({ ok: true }),
      (e) => {
        console.error('Sieve could not block the picked item', e);
        respond({ ok: false });
      },
    );
  return true;
}
