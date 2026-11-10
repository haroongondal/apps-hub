import { EVENTS, mainSettings, readMainState, ytPage, type MainCommand, type MainState, type YtPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { validateYouTube, YOUTUBE_KEY, type YouTubeSettings } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { NAV } from './selectors.ts';

// inspected 2026-11-10, local watch fixture (not youtube.com, so no sign-in), Chrome for Testing 149.0.7827.55 headless: an isolated-world mark at
// document_start is in the main world's performance.getEntriesByName (no <html> attribute fallback); headless records first-paint and first-contentful-paint.
export const APPLIED_MARK = 'sieve-yt-applied';

type SettingsCb = (y: YouTubeSettings, on: boolean) => void;
const settingsCbs: SettingsCb[] = [];
const navCbs: ((p: YtPage) => void)[] = [];
const stateCbs: ((s: MainState) => void)[] = [];
const off = new Set<string>();
let current: YouTubeSettings | null = null;
let state: MainState | null = null;
let flags: string[] = [];

export function feature(name: string, init: () => void): void {
  try {
    init();
  } catch (e) {
    if (off.has(name)) return;
    off.add(name);
    console.warn('Sieve: %s is off on this page', name, e);
  }
}

function safely<A extends unknown[]>(cb: (...args: A) => void, ...args: A): void {
  try {
    cb(...args);
  } catch (e) {
    console.error('Sieve: a YouTube feature failed', e);
  }
}

export const currentPage = (): YtPage => ytPage(location.href);

export function onSettings(cb: SettingsCb): void {
  settingsCbs.push(cb);
  if (current) safely(cb, current, current.on);
}

// Runs twice on a hard load (first settings, then YouTube's own hard-load NAV.finish), so callbacks must be idempotent.
export function onNavigate(cb: (p: YtPage) => void): void {
  navCbs.push(cb);
}

export function addStyle(css: string): void {
  const style = document.createElement('style');
  style.dataset.sieve = '';
  style.textContent = css;
  document.documentElement.append(style);
}

export function setStyle(id: string, css: string): void {
  let style = document.documentElement.querySelector<HTMLStyleElement>(`style[data-sieve="${CSS.escape(id)}"]`);
  if (!style) {
    style = document.createElement('style');
    style.dataset.sieve = id;
    document.documentElement.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function setFlag(name: string, on: boolean): void {
  flags = flags.filter((f) => f !== name);
  if (on) flags.push(name);
  if (flags.length) document.documentElement.setAttribute('sieve-yt', flags.join(' '));
  else document.documentElement.removeAttribute('sieve-yt');
}

export const toMain = (cmd: MainCommand): void => void document.dispatchEvent(new CustomEvent(EVENTS.do, { detail: cmd }));

export function onMainState(cb: (s: MainState) => void): void {
  stateCbs.push(cb);
}

export const mainState = (): MainState | null => state;

export async function saveYouTube(patch: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'yt-set', patch })) as { ok?: unknown; message?: unknown } | undefined;
    if (reply?.ok === true) return { ok: true };
    return { ok: false, message: typeof reply?.message === 'string' ? reply.message : 'Sieve could not save the setting. Reload the page, then try again.' };
  } catch {
    return { ok: false, message: 'Sieve was reloaded or turned off. Reload this page, then try again.' };
  }
}

const tellMain = (): void => {
  if (current) document.dispatchEvent(new CustomEvent(EVENTS.settings, { detail: mainSettings(current, current.on) }));
};

function apply(raw: unknown): void {
  const first = current === null;
  current = validateYouTube(raw);
  for (const cb of settingsCbs) safely(cb, current, current.on);
  if (first) performance.mark(APPLIED_MARK);
  tellMain();
  if (first) for (const cb of navCbs) safely(cb, currentPage());
}

export function startBridge(youtube: unknown): void {
  if (currentPage().kind !== 'other') apply(youtube);
}

document.addEventListener(EVENTS.hello, tellMain);
document.addEventListener(EVENTS.state, (e) => {
  const s = readMainState((e as CustomEvent).detail);
  if (s === null || !current) return;
  state = s;
  for (const cb of stateCbs) safely(cb, s);
});
(NAV.target === 'window' ? window : document).addEventListener(NAV.finish, () => {
  if (current) for (const cb of navCbs) safely(cb, currentPage());
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && YOUTUBE_KEY in changes && current) apply(changes[YOUTUBE_KEY].newValue);
});
