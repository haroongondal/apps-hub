import { SETTINGS_COMMAND, actionOfCommand } from '@apps-hub/sieve-core/src/yt-actions.ts';

// A shortcut goes to the active tab's every frame (no frameId); the content script decides whether its frame acts (Task 2.3).
export async function onCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  if (command === SETTINGS_COMMAND) {
    await chrome.runtime.openOptionsPage().catch((e) => console.error('Sieve could not open its settings', e));
    return;
  }
  const action = actionOfCommand(command);
  if (action === null || tab?.id === undefined) return;
  // A tab with no Sieve content script (any page but YouTube) rejects; that is not an error.
  await chrome.tabs.sendMessage(tab.id, { type: 'yt-command', action }).catch(() => {});
}
