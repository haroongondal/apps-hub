import { validateSettings, type Channel } from '@apps-hub/sieve-core/src/settings.ts';
import { watchChannel, youtubeAdsOn, ytChannel } from '@apps-hub/sieve-core/src/youtube-ads.ts';
import './yt/actions.ts';
import './yt/autoplay.ts';
import { startBridge } from './yt/bridge.ts';
import './yt/loop.ts';
import './yt/menu.ts';
import './yt/row.ts';
import './yt/speed.ts';
import './yt/theme.ts';
import './yt/visual.ts';

// By video id: a hover preview or an autoplay prefetch is another video, so the menu names the channel of the page's own one.
const seen = new Map<string, Channel>();

// shortcut: a page allowlist entry is checked against the address when the settings arrive or change, not on YouTube's in-app navigation, as inject.ts does.
function tell(raw: unknown): void {
  const s = validateSettings(raw);
  const on = youtubeAdsOn(s, location.href, Array.from(location.ancestorOrigins));
  document.dispatchEvent(new CustomEvent('sieve-yt-allow', { detail: { on, ids: on ? s.blocking.youtubeAllowedChannels.map((c) => c.id) : [] } }));
}

document.addEventListener('sieve-yt-channel', (e) => {
  const c = ytChannel((e as CustomEvent).detail);
  if (c === null) return;
  seen.delete(c.videoId);
  seen.set(c.videoId, c);
  if (seen.size > 50) seen.delete(seen.keys().next().value as string);
});
chrome.runtime.onMessage.addListener((message: { type?: unknown } | null, _sender, respond) => {
  if (message?.type === 'yt-channel') respond(watchChannel(location.href, seen));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'settings' in changes) tell(changes.settings.newValue);
});
chrome.storage.local.get(['settings', 'youtube']).then(
  ({ settings, youtube }) => {
    tell(settings);
    startBridge(youtube);
  },
  (e) => console.error('Sieve could not read its settings on YouTube', e),
);
