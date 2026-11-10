// What Sieve knows about www.youtube.com's watch page. Every value below was read from the live page, never from memory:
// inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55, no extension (dQw4w9WgXcQ, a playlist, a channel's Videos page).
// When YouTube changes its markup, the live check in test/yt/fixture.mjs names the entry that stopped matching.

export const SEL = {
  // The only `video` in the document on a watch page (`video.html5-main-video` is the same element). It stays the same element
  // across in-app navigations, home and back. Its `src` is a `blob:` URL; `disablePictureInPicture` is false.
  player: '#movie_player',
  video: '#movie_player video',
  // On a hard-loaded browse page (a channel's Videos tab) `ytd-watch-flexy[hidden]` and `#movie_player` are in the document too:
  // gate features on the page kind, not on this selector alone. After a watch page navigates to home the root stays, hidden.
  watch: 'ytd-watch-flexy',
  // `ytd-watch-metadata` is the title block, the first block under the player (inside an unnamed `div.box` in `#below`).
  rowAnchor: 'ytd-watch-metadata',
  // `#player-container` is the player's box in both layouts (880x495 at 16,68, position absolute, in default layout; 1280x631
  // inside `#player-full-bleed-container` in theater). `#full-bleed-container` is the wrapper that is 0 px tall in default layout.
  playerBox: '#player-container',
  theaterBox: '#full-bleed-container',
  // YouTube's own name for this button is "Cinema mode" (label "Default view" in theater) in the en-GB UI.
  sizeButton: '.ytp-size-button',
  // Fixed, 56 px tall, z-index 2020. The inner `ytd-masthead` has z-index auto.
  masthead: '#masthead-container',
} as const;

// `ytd-watch-flexy` gets `theater` in theater layout and `default-layout` otherwise (never both).
export const THEATER_ATTR = 'theater';

// NOT INSPECTED: a signed-out profile in a light and in an emulated dark colour scheme gave `<html>` no `dark` attribute (it
// carries `darker-dark-theme`, `darker-dark-theme-deprecate`, `system-icons`, `color-version`, `typography`,
// `typography-spacing`, and no attribute was added or removed after load), so the dark theme was never on. `ytd-masthead` gets a
// bare `dark` attribute in theater layout. Task 2.13 sets this from an inspection with YouTube's dark theme switched on.
export const DARK_ATTR: string | null = null;

// The events are dispatched on `ytd-app` (`yt-page-data-updated` on `ytd-page-manager`) with `bubbles` and `composed` true, so a
// listener on `document` or on `window` gets them. `location.href` is the old address at `start` and the new one at `finish`
// and `data`. `finish` also fires once on a hard load (about 3 s in, after `yt-page-data-fetched`), on back and forward
// (`detail.fromHistory`) and after `player.nextVideo()` and `playVideoAt()`. Order on a watch to watch click:
// yt-navigate (on the clicked element), yt-navigate-start, yt-page-data-will-update, yt-player-updated, yt-page-data-fetched,
// yt-navigate-finish, yt-page-data-updated. `data` fires after `finish`, once per navigation and once on a hard load.
export const NAV = {
  start: 'yt-navigate-start',
  finish: 'yt-navigate-finish',
  data: 'yt-page-data-updated' as string | null,
  target: 'document' as 'document' | 'window',
} as const;

// Every candidate exists on `#movie_player`. Returns: the setters, `playVideo`, `pauseVideo`, `stopVideo`, `seekTo`, `mute`,
// `unMute`, `nextVideo`, `playVideoAt` and `addEventListener` return undefined. `getPlayerState`: -1 unstarted, 0 ended,
// 1 playing, 2 paused, 3 buffering, 5 cued (what `stopVideo` leaves). `getVideoData()` is an object with `video_id`, `author`,
// `title`, `isPlayable`, `errorCode`, `video_quality`, `isLive` and, in a playlist, `list`. `getPlaybackRate` a number;
// `getAvailablePlaybackRates` [0.25 … 2] in 0.25 steps. `getVolume` 0 to 100; `isMuted` a boolean. `getAvailableQualityLevels`
// ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto']; `getPlaybackQuality` one of those.
// `setPlaybackQualityRange(min, max)` with equal values changes the quality (240p, 720p seen) and fires onPlaybackQualityChange;
// `setPlaybackQuality(q)` did nothing in three tries (medium twice, auto): do not use it. `getPlaylist()` is an array of video ids, or
// null outside a playlist; `getPlaylistIndex()` is 0-based, or -1 outside one (the URL's `index=` is 1-based).
// `addEventListener(name, fn)` with a function: `onStateChange` (state number), `onPlaybackRateChange` (the rate),
// `onVolumeChange` ({ muted, volume, unstorable }) and `onPlaybackQualityChange` (the quality string) fired as seen. Other
// names (onApiChange, onReady, onError, onVideoDataChange, onCueRangeEnter, onAdStart) were accepted and never seen to fire.
export const PLAYER_API = [
  'getPlayerState', 'getVideoData', 'getPlaybackRate', 'setPlaybackRate', 'getAvailablePlaybackRates', 'getAvailableQualityLevels',
  'getPlaybackQuality', 'setPlaybackQuality', 'setPlaybackQualityRange', 'getVolume', 'setVolume', 'isMuted', 'mute', 'unMute',
  'getPlaylist', 'getPlaylistIndex', 'playVideoAt', 'nextVideo', 'stopVideo', 'pauseVideo', 'playVideo', 'seekTo', 'addEventListener',
] as const;
