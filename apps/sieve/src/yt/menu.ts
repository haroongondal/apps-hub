import { YT_ACTIONS } from '@apps-hub/sieve-core/src/yt-actions.ts';
import type { MainState, YtPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import type { YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { actionStates, onActionsChanged, runAction } from './actions.ts';
import { currentPage, mainState, onMainState, onNavigate, onSettings } from './bridge.ts';

export interface MenuSnapshot { type: 'state'; page: YtPage; state: MainState | null; pressed: Record<string, boolean>; settings: YouTubeSettings }

const SPACING_MS = 100;
const ports = new Set<chrome.runtime.Port>();
let settings: YouTubeSettings | null = null;
let sentAt = -Infinity;
let timer: ReturnType<typeof setTimeout> | undefined;

const snapshot = (): MenuSnapshot | null => settings && { type: 'state', page: currentPage(), state: mainState(), pressed: actionStates(), settings };

function push(): void {
  if (!ports.size || timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    sentAt = Date.now();
    const s = snapshot();
    if (s) for (const p of ports) p.postMessage(s);
  }, Math.max(0, sentAt + SPACING_MS - Date.now()));
}

onSettings((y) => {
  settings = y;
  push();
});
onMainState(push);
onActionsChanged(push);
onNavigate(push);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'yt-menu') return;
  const first = snapshot();
  if (!first) return port.disconnect();
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((m: { type?: unknown; action?: unknown; value?: unknown } | null) => {
    if (m?.type !== 'do' || typeof m.action !== 'string' || !settings?.on || !YT_ACTIONS.some((a) => a.id === m.action)) return;
    runAction(m.action, typeof m.value === 'string' ? m.value : undefined)
      .catch((e) => console.error('Sieve could not run a YouTube action', e))
      .finally(push);
  });
  port.postMessage(first);
});
