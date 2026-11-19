import { nextVolume } from '@apps-hub/sieve-core/src/playback.ts';
import { ytPage, type MainSettings } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onCommand, onSettings, onVideo, player, sendState } from './bridge-main.ts';
import { SEL } from './selectors.ts';

// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: getVolume is 0 to 100, setVolume(40) gave video.volume 0.357 (not linear),
// onVolumeChange gives { muted, volume, unstorable }; so the level is always the player's own 0 to 100, never video.volume.
// inspected 2026-11-11, signed out, Chrome for Testing 149.0.7827.55: setVolume(30) at the first loadstart of a hard load was still 30 about 4 s into playback (live check).
const apply = Reflect.apply;
const listen = EventTarget.prototype.addEventListener;
const query = Document.prototype.querySelector;

feature('volume', () => {
  if (ytPage(location.href).kind === 'other') return;
  let settings: MainSettings | null = null;
  let seen = false; // a video has started on this page

  function report(): void {
    const p = player();
    if (p) sendState({ volume: p.getVolume(), muted: p.isMuted() });
  }

  function applyDefault(): void {
    const p = player();
    if (!settings?.on || !settings.volume.setDefault || !p) return;
    p.setVolume(settings.volume.level);
    if (settings.volume.level > 0 && p.isMuted()) p.unMute();
    report();
  }

  onSettings((s) => {
    const first = settings === null;
    settings = s;
    if (first && seen) applyDefault(); // the settings reached a hard load after its first video had started
  });
  onVideo(() => {
    seen = true;
    applyDefault();
    report();
  });
  apply(listen, document, ['volumechange', (e: Event) => {
    if (e.target === apply(query, document, [SEL.video])) report();
  }, true]);
  onCommand('volume-step', (value) => {
    const p = player();
    if (!settings?.on || !p || (value !== 1 && value !== -1)) return;
    const next = nextVolume(p.getVolume(), value, settings.volume.step);
    p.setVolume(next);
    if (next > 0 && p.isMuted()) p.unMute();
    report(); // after every step, even at 0 or 100, so the row can toast the level
  });
});
