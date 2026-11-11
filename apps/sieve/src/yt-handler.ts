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

// Tabs that have played a video, and so hold a content script that can pause it. Session storage, so a stopped worker still knows them.
const PLAYERS_KEY = 'ytPlayers';
const TOKEN = /^[\w-]{1,64}$/;
const GONE = /Receiving end does not exist|No tab with id/;
let players: Promise<void> = Promise.resolve();

// One at a time: each run reads the set, so two overlapping runs would drop a tab.
function pauseOthers(tab: number, token: string): Promise<void> {
  const run = async (): Promise<void> => {
    const { [PLAYERS_KEY]: stored } = await chrome.storage.session.get(PLAYERS_KEY);
    const ids = [...new Set<number>([...(Array.isArray(stored) ? stored.filter(Number.isInteger) : []), tab])];
    // The sender's own tab is told too, so its other frames hear it; the frame that played spares itself by its token.
    const gone = await Promise.all(ids.map((id) => chrome.tabs.sendMessage(id, { type: 'yt-pause', except: token }).then(() => false, (e) => GONE.test(String(e?.message ?? e)))));
    await chrome.storage.session.set({ [PLAYERS_KEY]: ids.filter((_, i) => !gone[i]) });
  };
  return (players = players.then(run, run));
}

export function onYouTubeMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void): boolean {
  const m = isRecord(message) ? message : {};
  if (m.type === 'open-settings' && m.section === 'youtube') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#youtube') }).catch((e) => console.error('Sieve could not open its settings', e));
    return false;
  }
  if (m.type === 'yt-playing') {
    const tab = sender.tab?.id;
    if (!Number.isInteger(tab) || (tab as number) < 0 || typeof m.token !== 'string' || !TOKEN.test(m.token)) {
      respond({ ok: false });
      return false;
    }
    pauseOthers(tab as number, m.token).then(
      () => respond({ ok: true }),
      (e) => {
        console.error('Sieve could not pause the other videos', e);
        respond({ ok: false });
      },
    );
    return true;
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
