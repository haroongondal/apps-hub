import { DEFAULT_SETTINGS } from '@apps-hub/sieve-core/src/settings.ts';
import { applyBlockingSoon } from './blocking.ts';

// Listeners are added synchronously at the top level, so Chrome can deliver the event that woke a stopped worker.
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings === undefined) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  applyBlockingSoon();
});
chrome.runtime.onStartup.addListener(applyBlockingSoon);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('settings' in changes || 'myRules' in changes)) applyBlockingSoon();
});
