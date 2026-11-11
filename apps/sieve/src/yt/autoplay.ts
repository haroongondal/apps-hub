import { stopThisPlay } from '@apps-hub/sieve-core/src/autoplay.ts';
import type { AutoplayMode } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { currentPage, feature, onSettings } from './bridge.ts';
import { SEL } from './selectors.ts';

const loadedHidden = document.visibilityState === 'hidden';
// Random per frame: the worker tells every frame of every tab, and a frame spares the one token it sent.
const token = crypto.randomUUID();
// With no focused element YouTube takes these on the page, so a trusted press of one counts as the owner pressing play.
const PLAY_KEYS = new Set([' ', 'k', 'K']);

const isVideo = (t: EventTarget | null): t is HTMLVideoElement => t instanceof HTMLVideoElement && t.matches(SEL.video);

feature('autoplay', () => {
  let on = false;
  let mode: AutoplayMode = 'allow';
  let playlists = true;
  let pauseOthers = false;
  let lastInput = -Infinity;
  let firstPlay = true;
  let firstVideo = true;

  // Capture on the document: media events do not bubble, and the video element may not exist yet.
  const when = (type: string, fn: (v: HTMLVideoElement, e: Event) => void): void =>
    document.addEventListener(type, (e) => { if (e.isTrusted && isVideo(e.target)) fn(e.target, e); }, true);
  const input = (e: Event): void => {
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest(SEL.player) || (e.type === 'keydown' && (t === document.body || t === document.documentElement || t === null) && PLAY_KEYS.has((e as KeyboardEvent).key))) lastInput = performance.now();
  };
  document.addEventListener('pointerdown', (e) => { if (e.isTrusted) input(e); }, true);
  document.addEventListener('keydown', (e) => { if (e.isTrusted) input(e); }, true);

  // A new source on the element is a new video, whose first play is the one to judge.
  when('emptied', () => { firstPlay = true; });
  when('loadstart', () => { firstPlay = true; });
  when('play', (v) => {
    if (!on) return;
    const stop = stopThisPlay({ mode, playlists, loadedHidden, firstVideo, inPlaylist: currentPage().list !== null, firstPlay, sincePlayerInput: performance.now() - lastInput });
    firstVideo = false;
    // A video stays "new" until a play is let through, so a script that calls play() again after the pause is judged again.
    if (stop) v.pause();
    else firstPlay = false;
  });
  when('playing', async (v) => {
    if (!on || !pauseOthers || v.paused) return;
    try {
      await chrome.runtime.sendMessage({ type: 'yt-playing', token });
    } catch {} // Sieve was reloaded or turned off: there is nobody to tell
  });

  chrome.runtime.onMessage.addListener((m: { type?: unknown; except?: unknown } | null) => {
    if (m?.type !== 'yt-pause' || typeof m.except !== 'string' || m.except === token || !on || !pauseOthers) return;
    const v = document.querySelector<HTMLVideoElement>(SEL.video);
    if (v && !v.paused && !v.ended) v.pause();
  });
  onSettings((y, isOn) => {
    on = isOn;
    ({ mode, playlists, pauseOthers } = y.autoplay);
  });
});
