import { pickQuality, qualityContext, qualityTarget } from '@apps-hub/sieve-core/src/quality.ts';
import { QUALITIES, type Quality, type QualityChoice } from '@apps-hub/sieve-core/src/youtube-settings.ts';
import { ytPage, type MainSettings } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onCommand, onSettings, onVideo, player, sendState, type YtPlayer } from './bridge-main.ts';

// Player facts, inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55, no extension (dQw4w9WgXcQ; tools in test/yt/quality.mjs's live check):
// - setPlaybackQualityRange(q, q) changes getPlaybackQuality() within 250 ms (large, hd720, hd1080, hd2160 seen) and fires onPlaybackQualityChange;
//   setPlaybackQuality(q) did nothing (small, tried once more here): never use it.
// - setPlaybackQualityRange('auto', 'auto') and ('auto') leave the picture where it is but set getPreferredQuality() back to 'auto'; any other
//   pair sets the preference to its maximum ('hd1080' after (hd1080, hd1080), 'highres' after (tiny, highres)).
// - A new video resets getPreferredQuality() to 'auto' (set hd1080, click a related video: 'auto'), so every video needs its own call.
// - getAvailableQualityLevels() was already filled at the video's loadstart, also for an in-app navigation (7 or 9 entries, 0 ms):
//   the wait below is for the slow case.
// - The playing codec: getStatsForNerds().codecs, e.g. "av01.0.05M.08 (398) / opus (251)" (the "Stats for nerds" text; no argument).
const SETTLE_MS = 10_000;
const EVERY_MS = 250;
const later = setTimeout;
const stop = clearTimeout;
const listen = EventTarget.prototype.addEventListener;
const apply = Reflect.apply;
const now = performance.now.bind(performance);
const COMMANDS: Record<string, QualityChoice> = Object.fromEntries(['auto', ...QUALITIES].map((q) => [`quality-${q}`, q as QualityChoice]));

feature('quality', () => {
  if (ytPage(location.href).kind === 'other') return;
  let settings: MainSettings | null = null;
  let seen = false; // a video has started on this page
  let last: QualityChoice = 'auto'; // what this module last chose (the player starts every video on auto)
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  let warned = false;
  const watched = new WeakSet<object>();

  const isQuality = (l: string): l is Quality => (QUALITIES as readonly string[]).includes(l);
  const known = (p: YtPlayer): Quality[] => p.getAvailableQualityLevels().filter(isQuality); // the player's order, highest first

  function target(p: YtPlayer): QualityChoice {
    // Both kinds are fixed per frame except `list`. inspected 2026-11-17, signed out, Chrome for Testing 149.0.7827.55: getVideoData().list is unset
    // at a video's loadstart on a hard-loaded playlist page (set about 2 s later, after loadedmetadata) and on a move to the playlist's next video
    // (set 0.15 s later), while the address already shows the new video and its list=. So the address counts, but only when it shows this video:
    // a list= left from the video before does not.
    // Not measured: an in-app click into a non-Mix playlist; if the address lagged there and the player had no list, it would get the Videos quality.
    const page = ytPage(location.href);
    const data = p.getVideoData();
    return qualityTarget(qualityContext({ ...page, list: data?.list || (page.videoId === data?.video_id ? page.list : null) }), document.fullscreenElement !== null, settings!.quality);
  }

  function cancel(): void {
    ticket++;
    stop(timer);
    waiting = false;
  }

  // Waits (every 250 ms for 10 s, cancelled by the next call) until the player offers a known label, then sets `want` and reports.
  function settle(want: QualityChoice | null): void {
    if (want === null && waiting) return; // a report must not cancel a quality still waiting to be set
    cancel();
    const mine = ticket;
    const started = now();
    const tick = (): void => {
      if (mine !== ticket) return;
      waiting = false;
      if (!settings?.on) return;
      let done = false;
      try {
        const p = player();
        const levels = p ? known(p) : [];
        if (p && levels.length) {
          const level = want === null ? null : want === 'auto' ? 'auto' : pickQuality(levels, want);
          if (level) p.setPlaybackQualityRange(level, level);
          done = true; // set: a throw while reporting must not set it again
          watch(p);
          sendState({ quality: p.getPlaybackQuality(), qualities: levels });
          return;
        }
      } catch (e) {
        if (!warned) console.warn('Sieve: quality could not be read', e);
        warned = true;
        if (done) return;
      }
      if (now() - started < SETTLE_MS) {
        waiting = true;
        timer = later(tick, EVERY_MS);
      }
    };
    tick();
  }

  function watch(p: YtPlayer): void {
    if (watched.has(p)) return;
    watched.add(p);
    p.addEventListener('onPlaybackQualityChange', (q) => {
      if (typeof q === 'string') sendState({ quality: q });
    });
  }

  function run(reason: 'video' | 'settings' | 'fullscreen'): void {
    const p = player();
    if (!settings?.on || !seen || !p) return;
    const goal = target(p);
    // A new video starts on auto already, and a setting or full-screen change that leaves the target as it was keeps a quality picked by hand.
    if (reason === 'video' ? goal === 'auto' : goal === last) {
      last = goal;
      return settle(null);
    }
    last = goal;
    settle(goal);
  }

  onSettings((s) => {
    settings = s;
    run('settings');
  });
  onVideo(() => {
    seen = true;
    cancel();
    run('video');
  });
  apply(listen, document, ['fullscreenchange', () => run('fullscreen')]);
  for (const [action, level] of Object.entries(COMMANDS)) onCommand(action, () => settle(level));
});
