import { DEFAULT_SETTINGS } from '@apps-hub/sieve-core/src/settings.ts';
import { applyBlockingSoon } from './blocking.ts';
import { initBadge, onMatched, onNavigated, onTabRemoved } from './counts.ts';
import { forgetStored, onCommitted } from './inject.ts';
import { onPanelConnect } from './panels.ts';
import { onMessage } from './pick-handler.ts';
import { onYouTubeMessage } from './yt-handler.ts';

// Listeners are added synchronously at the top level, so Chrome can deliver the event that woke a stopped worker.
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings === undefined) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  applyBlockingSoon();
});
chrome.runtime.onStartup.addListener(applyBlockingSoon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('settings' in changes || 'myCosmetic' in changes)) forgetStored();
  if (area === 'local' && ('settings' in changes || 'myRules' in changes || 'myCosmetic' in changes)) applyBlockingSoon();
});
chrome.runtime.onMessage.addListener(onMessage);
chrome.runtime.onMessage.addListener(onYouTubeMessage);
chrome.runtime.onConnect.addListener(onPanelConnect);
chrome.webNavigation.onCommitted.addListener(onCommitted, { url: [{ schemes: ['http', 'https'] }] });
initBadge();
// Only unpacked extensions have the debug event; without it the menu shows no counts, and the worker still starts.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(onMatched);
chrome.webNavigation.onCommitted.addListener(onNavigated);
chrome.tabs.onRemoved.addListener(onTabRemoved);
