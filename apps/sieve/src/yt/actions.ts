import type { YtActionId } from '@apps-hub/sieve-core/src/yt-actions.ts';
import { currentPage, onSettings, toMain } from './bridge.ts';
import { SEL } from './selectors.ts';

type Action = { run: (value?: string) => void | Promise<void>; pressed?: () => boolean };
const actions = new Map<string, Action>();
const changed: (() => void)[] = [];
let on = false;

export function defineAction(id: YtActionId, run: Action['run'], pressed?: () => boolean): void {
  actions.set(id, { run, pressed });
}

export async function runAction(id: string, value?: string): Promise<void> {
  const a = actions.get(id);
  if (a) await a.run(value);
  else toMain(value === undefined ? { action: id } : { action: id, value });
}

export function actionStates(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, a] of actions) if (a.pressed) out[id] = a.pressed();
  return out;
}

export function onActionsChanged(cb: () => void): void {
  changed.push(cb);
}

export function notifyActions(): void {
  for (const cb of changed) cb();
}

// A shortcut reaches every frame of the tab: the top frame acts on YouTube pages, an embed only while its video plays.
function acts(): boolean {
  if (!on) return false;
  const kind = currentPage().kind;
  if (window === window.top) return kind !== 'other';
  const video = document.querySelector<HTMLVideoElement>(SEL.video);
  return kind === 'embed' && !!video && !video.paused && !video.ended;
}

onSettings((_y, isOn) => {
  on = isOn;
});
chrome.runtime.onMessage.addListener((message: { type?: unknown; action?: unknown; value?: unknown } | null) => {
  if (message?.type !== 'yt-command' || typeof message.action !== 'string' || !acts()) return;
  runAction(message.action, typeof message.value === 'string' ? message.value : undefined).catch((e) => console.error('Sieve could not run a YouTube action', e));
});
