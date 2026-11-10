import { ytPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onCommand, onSettings, player, sendState } from './bridge-main.ts';

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

  apply(listen, document, ['loadstart', () => (advanced = false), true]);
  apply(listen, document, ['loadedmetadata', sendPlaylist, true]);
  apply(listen, document, [
    'timeupdate',
    (e: Event) => {
      const v = e.target as HTMLVideoElement;
      if (!on || advanced || !isReversed() || v.loop || !(v.duration - v.currentTime < REMAINING_S)) return;
      const p = player();
      const box = p as unknown as Element | null;
      if (!box || !box.contains(v) || box.classList.contains('ad-showing')) return;
      const index = p!.getPlaylistIndex();
      if (index <= 0) return;
      advanced = true;
      p!.playVideoAt(index - 1);
    },
    true,
  ]);
});
