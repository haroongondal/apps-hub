import { validateSettings, type Channel } from '@apps-hub/sieve-core/src/settings.ts';
import { youtubeAdsOn, ytChannel } from '@apps-hub/sieve-core/src/youtube-ads.ts';

let channel: Channel | null = null;

// shortcut: a page allowlist entry is checked against the address when the settings arrive or change, not on YouTube's in-app navigation, as inject.ts does.
function tell(raw: unknown): void {
  const s = validateSettings(raw);
  const on = youtubeAdsOn(s, [location.href, ...Array.from(location.ancestorOrigins)]);
  document.dispatchEvent(new CustomEvent('sieve-yt-allow', { detail: { on, ids: on ? s.blocking.youtubeAllowedChannels.map((c) => c.id) : [] } }));
}

document.addEventListener('sieve-yt-channel', (e) => {
  channel = ytChannel((e as CustomEvent).detail) ?? channel;
});
chrome.runtime.onMessage.addListener((message: { type?: unknown } | null, _sender, respond) => {
  if (message?.type === 'yt-channel') respond(location.pathname === '/watch' ? channel : null);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'settings' in changes) tell(changes.settings.newValue);
});
chrome.storage.local.get('settings').then(({ settings }) => tell(settings), (e) => console.error('Sieve could not read its settings on YouTube', e));
