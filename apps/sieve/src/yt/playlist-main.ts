import { ytPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onCommand, onSettings, onVideo, player, sendState } from './bridge-main.ts';
import { NAV } from './selectors.ts';

// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55 (26-item public playlist): getPlaylistIndex() is 0-based (the address's index= is 1-based); playVideoAt(i) moves to item i as an in-app navigation; stopVideo() leaves state 5, #movie_player.unstarted-mode, a black player with no src, and playVideo() restarts at 0:00.
// Same run: at a new video's loadstart getPlaylist() is null and getPlaylistIndex() is -1 (both set by loadedmetadata, so the playlist is read there). NOT measured: playVideoAt 0.5 s before the end vs YouTube's own advance, because seeks and playback past about 45 s stall in the test profile.
const REMAINING_S = 0.6;
const listen = EventTarget.prototype.addEventListener;
const apply = Reflect.apply;

feature('stop and reversed playlist', () => {
  if (ytPage(location.href).kind === 'other') return;
  let on = false;
  let reversed = false;
  let reversedFor: string | null = null;
  let advanced = false;

  function isReversed(): boolean {
    if (reversed && ytPage(location.href).list !== reversedFor) reversed = false;
    return reversed;
  }

  function sendPlaylist(): void {
    const p = player();
    const ids = p?.getPlaylist();
    sendState({ playlist: p && ids ? { index: p.getPlaylistIndex(), length: ids.length, reversed: isReversed() } : null });
  }

  onSettings((s) => {
    on = s.on;
    sendPlaylist();
  });
  onCommand('stop', () => player()?.stopVideo());
  onCommand('reverse-playlist', () => {
    const list = ytPage(location.href).list;
    reversed = list !== null && !isReversed();
    reversedFor = list;
    sendPlaylist();
  });

  const safe = (fn: (e: Event) => void) => (e: Event) => {
    try {
      fn(e);
    } catch (err) {
      console.error('Sieve: a YouTube feature failed', err);
    }
  };
  const inPlayer = (target: EventTarget | null): boolean => {
    const box = player() as unknown as Element | null;
    return !!box && target instanceof Node && box.contains(target) && !box.classList.contains('ad-showing');
  };

  onVideo(() => (advanced = false));
  apply(listen, NAV.target === 'window' ? window : document, [NAV.finish, safe(sendPlaylist)]);
  apply(listen, document, ['loadedmetadata', safe(sendPlaylist), true]);
  apply(listen, document, [
    'timeupdate',
    safe((e) => {
      const v = e.target as HTMLVideoElement;
      if (!on || advanced || !isReversed() || v.loop || !(v.duration - v.currentTime < REMAINING_S) || !inPlayer(v)) return;
      const p = player()!;
      const index = p.getPlaylistIndex();
      if (index <= 0) return;
      advanced = true;
      p.playVideoAt(index - 1);
    }),
    true,
  ]);
  // The video can still end before the move has loaded; YouTube's own advance would then go forward and undo it.
  apply(listen, document, ['ended', safe((e) => advanced && !(e.target as HTMLVideoElement).loop && inPlayer(e.target) && e.stopImmediatePropagation()), true]);
});
