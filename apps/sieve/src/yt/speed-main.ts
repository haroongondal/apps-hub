import { MAX_RATE, MIN_RATE, nextSpeed, snapSpeed } from '@apps-hub/sieve-core/src/playback.ts';
import { ytPage, type MainSettings } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onCommand, onSameVideoSource, onSettings, onVideo, player, sendState, type YtPlayer } from './bridge-main.ts';
import { SEL } from './selectors.ts';

// Speed facts, inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55, no extension (dQw4w9WgXcQ, then related videos; Playwright addInitScript probes):
// - player.setPlaybackRate(r) takes effect at once and fires the video's ratechange, but the player clamps to its own list: 2.5 and 3 gave 2, 0.3 gave 0.3.
// - video.playbackRate = r (2.5, 16 and 0.1 tried) fires ratechange, stays after 5 s and after seekTo(20), and the player is not told:
//   player.getPlaybackRate() kept answering the old 2. So the rate is read from the video, never from the player.
// - A new video starts at 1 again, whether the rate was set through the player or directly, and localStorage held no speed key: YouTube remembers
//   nothing here. The reset happens before the video's loadstart (rate 1 at loadstart, no ratechange).
// - A rate set at loadstart (1.75) and one set at loadedmetadata (1.25) both held through canplay and playing, 3 s later too.
// From this: `anySpeed` sets the rate directly on the video, otherwise through the player, snapped to its offered rates. The default goes on at
// onVideo (loadstart). It goes on once more at the first `playing` when something changed it meanwhile (a signed-in profile may carry a
// remembered speed; the signed-out inspection could not show one), but only within 5 s, in the first 2 s of the video, and when no speed
// command, key or pointer press came in between. The 2 s guard also skips the safeguard for a resumed video on a signed-in profile
// (accepted trade-off; on the owner checklist, Task 2.19).
const apply = Reflect.apply;
const listen = EventTarget.prototype.addEventListener;
const query = Document.prototype.querySelector;
const now = performance.now.bind(performance);
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

feature('speed', () => {
  if (ytPage(location.href).kind === 'other') return;
  let settings: MainSettings | null = null;
  let seen = false; // a video has started on this page
  let wanted: number | null = null; // the default applied to the current video, until its first `playing`, a speed command or a key or pointer press
  let armed = 0; // when `wanted` was set
  let rate = 1; // the video's rate as its last ratechange left it
  // `rate` when the current source was emptied: the load has already reset playbackRate to 1 by then, so this is the rate the last
  // ratechange left; a ratechange to 1 that Chrome may queue between `emptied` and `loadstart` does not reach it.
  let kept = 1;
  const video = (): HTMLVideoElement | null => apply(query, document, [SEL.video]) as HTMLVideoElement | null;

  function setRate(rate: number): number | null {
    const p = player();
    const v = video();
    if (!p || !v || !settings) return null;
    const r = Math.min(MAX_RATE, Math.max(MIN_RATE, settings.speed.anySpeed ? rate : snapSpeed(rate, p.getAvailablePlaybackRates())));
    if (settings.speed.anySpeed) v.playbackRate = r;
    else p.setPlaybackRate(r);
    return r;
  }

  function applyDefault(): void {
    const p = player();
    wanted = null;
    if (!settings?.on || !settings.speed.setDefault || !p || p.getVideoData()?.isLive) return;
    wanted = setRate(settings.speed.default);
    armed = now();
  }

  // A command always reports the rate afterwards, so the row shows the toast even when the rate did not change.
  function command(rate: (v: HTMLVideoElement, p: YtPlayer) => number): void {
    const v = video();
    const p = player();
    if (!settings?.on || !v || !p) return;
    wanted = null;
    const next = rate(v, p);
    if (!near(next, v.playbackRate)) setRate(next); // a speed outside the offered ones is not snapped back into them by a step that went nowhere
    sendState({ rate: v.playbackRate });
  }

  onSettings((s) => {
    const first = settings === null;
    settings = s;
    if (first && seen) applyDefault(); // the settings reached a hard load after its first video had started
  });
  onVideo(() => {
    seen = true;
    applyDefault();
    // A new video starts at 1 without a ratechange (inspected), so the row learns the rate here even when no default went on.
    sendState({ rate: (rate = video()?.playbackRate ?? 1) });
  });
  apply(listen, document, ['ratechange', (e: Event) => {
    const v = video();
    if (v && e.target === v) sendState({ rate: (rate = v.playbackRate) });
  }, true]);
  apply(listen, document, ['emptied', (e: Event) => {
    if (e.target === video()) kept = rate;
  }, true]);
  // inspected 2026-11-17, signed out, Chrome for Testing 149.0.7827.55: a start that stalled at 0 s got a new source for the same video about
  // 20 s later (emptied, loadstart) at rate 1 with no ratechange, so the default 1.5 was lost; the miniplayer (key i) did the same to a 1.75.
  // The same video keeps the speed it had.
  onSameVideoSource(() => {
    const v = video();
    if (settings?.on && v && !near(v.playbackRate, kept)) v.playbackRate = kept;
  });
  // Only a video that has just started: later (a seek, a key press, a pointer press) a different rate is the owner's choice or the page's own.
  apply(listen, document, ['playing', (e: Event) => {
    const v = video();
    if (!v || e.target !== v || wanted === null) return;
    const goal = wanted;
    wanted = null;
    if (settings?.on && settings.speed.setDefault && v.currentTime <= 2 && now() - armed <= 5000 && !near(v.playbackRate, goal)) setRate(goal);
  }, true]);
  for (const type of ['keydown', 'pointerdown']) apply(listen, document, [type, (e: Event) => { if (e.isTrusted) wanted = null; }, true]);
  onCommand('speed-step', (value) => {
    if (value === 1 || value === -1) command((v, p) => nextSpeed(v.playbackRate, value, { step: settings!.speed.step, anySpeed: settings!.speed.anySpeed, rates: p.getAvailablePlaybackRates() }));
  });
  onCommand('speed-set', (value) => {
    if (typeof value === 'number') command(() => value);
  });
  onCommand('speed-default', () => command(() => (settings!.speed.setDefault ? settings!.speed.default : 1)));
  onCommand('speed-normal', () => command(() => 1));
});
