import { stopThisPlay } from '@apps-hub/sieve-core/src/autoplay.ts';
import type { AutoplayMode } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { currentPage, feature, onNavigate, onSettings } from './bridge.ts';
import { SEL } from './selectors.ts';

// Page events. inspected 2026-11-11, signed out, Chrome for Testing 149.0.7827.55, dQw4w9WgXcQ in a playlist, "In every tab" and playlists off:
// - On a hard load the real <video> fires trusted `emptied`, `play`, `loadstart` (in that order, within 10 ms) about 1.5 s in, and `pause` from my
//   `video.pause()`; the play button then reads "Play" (getPlayerState 2). YouTube itself calls play() again about 1.5 s later (a second `play` and
//   `playing`, trusted, no input), so a video stays "new" until a play is let through: with "the first play only" that retry would have started it.
// - A trusted click in the player gave `play` and `playing` at once and it played on (state 1, "Pause").
// - `player.nextVideo()` in the playlist: `emptied`, `play`, `loadstart` for the new video, location already holding `list=` and the new index,
//   so `currentPage().list` is right at play time. With playlists off the new video was paused (state -1, "Play"); with playlists on it played.
// - `emptied` and `loadstart` also fire when YouTube swaps the source between an ad and the content (same video id), so they do not mean a new video.
// - Not seen: an ad as the first play (`ad-showing` was never set), a key press, a non-playlist in-app navigation.
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

  // A new video is a new address (or video id): a source swap on the same video, as between an ad and the content, is not one.
  let judged: string | null | undefined;
  const rearm = (): void => {
    const id = currentPage().videoId;
    if (id === judged) return;
    judged = id;
    firstPlay = true;
  };
  onNavigate(rearm);
  when('play', (v) => {
    if (!on) return;
    rearm();
    // An ad is never stopped. It leaves the state as it was for the video that follows, unless the owner started it.
    if (document.querySelector(SEL.player)?.classList.contains('ad-showing')) {
      if (performance.now() - lastInput < 1000) firstPlay = false;
      return;
    }
    const stop = stopThisPlay({ mode, playlists, loadedHidden, firstVideo, inPlaylist: currentPage().list !== null, firstPlay, sincePlayerInput: performance.now() - lastInput });
    // A video stays "new" until a play is let through, so a script that calls play() again after the pause is judged again,
    // and a tab that loaded hidden stays on its first video until one has played.
    if (stop) v.pause();
    else firstPlay = firstVideo = false;
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
