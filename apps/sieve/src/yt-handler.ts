import { isPngDataUrl, screenshotName } from '@apps-hub/sieve-core/src/screenshot.ts';
import { isRecord } from '@apps-hub/sieve-core/src/settings.ts';
import { mergeYouTube, validateYouTube, YOUTUBE_KEY } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { withSettingsLock } from './lock.ts';

const MAX_SCREENSHOT = 64 * 1024 * 1024;

// A content script's Web Lock belongs to youtube.com, so YouTube settings are written here, under the extension's lock.
const save = (patch: Record<string, unknown>): Promise<void> =>
  withSettingsLock(async () => {
    const { [YOUTUBE_KEY]: stored } = await chrome.storage.local.get(YOUTUBE_KEY);
    await chrome.storage.local.set({ [YOUTUBE_KEY]: mergeYouTube(validateYouTube(stored), patch) });
  });

export function onYouTubeMessage(message: unknown, _sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean {
  const m = isRecord(message) ? message : {};
  if (m.type === 'open-settings' && m.section === 'youtube') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#youtube') }).catch((e) => console.error('Sieve could not open its settings', e));
    return false;
  }
  if (m.type === 'yt-screenshot') {
    if (!isPngDataUrl(m.dataUrl, MAX_SCREENSHOT)) {
      respond({ ok: false, message: 'the picture is not a PNG or is too big' });
      return false;
    }
    // Chrome makes the Sieve folder in Downloads. These downloads carry this extension's id, which phase 3's take-over must skip.
    const filename = 'Sieve/' + screenshotName(typeof m.title === 'string' ? m.title : '', Number(m.seconds) || 0);
    chrome.downloads.download({ url: m.dataUrl, filename, conflictAction: 'uniquify', saveAs: false }).then(
      () => respond({ ok: true }),
      (e) => respond({ ok: false, message: String(e?.message ?? e) }),
    );
    return true;
  }
  if (m.type !== 'yt-set') return false;
  if (!isRecord(m.patch)) {
    respond({ ok: true });
    return false;
  }
  save(m.patch).then(
    () => respond({ ok: true }),
    (e) => {
      console.error('Sieve could not save a YouTube setting', e);
      respond({ ok: false, message: 'Sieve could not save the setting. Reload the page, then try again.' });
    },
  );
  return true;
}
