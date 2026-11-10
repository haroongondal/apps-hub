import { DOWNLOADS_KEY, validateDownloadSettings, type DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { withSettingsLock } from '../lock.ts';

export async function readDownloads(): Promise<DownloadSettings> {
  return validateDownloadSettings((await chrome.storage.local.get(DOWNLOADS_KEY))[DOWNLOADS_KEY]);
}

// Resolves false (and logs) on failure, as controls.ts `save` does. The edit runs on a copy read inside the lock.
export const saveDownloads = (edit: (s: DownloadSettings) => DownloadSettings): Promise<boolean> =>
  withSettingsLock(async () => {
    await chrome.storage.local.set({ [DOWNLOADS_KEY]: validateDownloadSettings(edit(await readDownloads())) });
  }).then(
    () => true,
    (e) => {
      console.error('Sieve could not save the download settings', e);
      return false;
    },
  );

// Only the worker's copy lives here; it dies with the worker, so a stale copy cannot outlive a restart.
let cache: Promise<DownloadSettings> | null = null;
let watching = false;
export function getDownloads(): Promise<DownloadSettings> {
  if (!watching) {
    watching = true;
    onDownloadsChanged(() => (cache = null));
  }
  return (cache ??= readDownloads().catch((e) => {
    cache = null;
    throw e;
  }));
}

export function onDownloadsChanged(cb: (s: DownloadSettings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && DOWNLOADS_KEY in changes) cb(validateDownloadSettings(changes[DOWNLOADS_KEY].newValue));
  });
}
