import { refuseConfig, refuseType } from '@apps-hub/sieve-core/src/quality.ts';
import { ytPage } from '@apps-hub/sieve-core/src/yt-bridge.ts';
import { feature, onSettings } from './bridge-main.ts';

// What the player asks the browser, inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55, no extension, dQw4w9WgXcQ:
// - MediaSource.isTypeSupported: 44 calls on the hard load (3 before #movie_player exists, 41 after), 58 after an in-app navigation.
//   First 20 distinct strings: before the player exists `video/webm; codecs="vp09.02.51.10.01.09.16.09.00"`,
//   `video/webm; codecs="vp09.02.51.10.01.09.99.99.00"` and `video/mp4; codecs="avc1.42001E"; decode-to-texture=true`; after it
//   `video/mp4; codecs="avc1.42001E"`, `audio/mp4; codecs="mp4a.40.2"`, `audio/webm; codecs="opus"` (also `; channels=2` and `; channels=99`),
//   `video/mp4; codecs=av01.0.05M.08` (no quotes), `video/mp4; codecs=av99.0.05M.08`, `video/webm; codecs="vp9"` with a `height=`, `width=`,
//   `framerate=30`, `framerate=9999` or `bitrate=` parameter, and `width=3840; height=2160; bitrate=2000000` (also 20000000).
//   The test strings are in packages/sieve-core/src/__tests__/quality.test.ts.
// - MediaCapabilities.decodingInfo: 17 calls on the hard load (1 before #movie_player exists), 31 after the navigation; always
//   `{ type: 'media-source', video: { contentType, width, height, bitrate, framerate } }` with `video/mp4; codecs="av01.0.12M.08"` (the first,
//   3840x2160 at framerate 60, before the player exists) and `video/webm; codecs="vp09.00.51.08.01.01.01.01.00"` at 2160p, 1440p, 1080p,
//   720p, 480p, 360p, 240p and 144p (framerate 25 or 30; AV1 at 4K to 1440p as well). Never an avc1 string, and never an audio member.
// - HTMLMediaElement.canPlayType: once, `audio/x-m4a`, after the player exists: audio is never refused, so it is not wrapped.
// - ManagedMediaSource does not exist in this Chrome, so it is not wrapped.
// A refusal therefore has to cover both isTypeSupported and decodingInfo: YouTube picks its ladder through decodingInfo.
// The first calls come before the settings reach the page (shortcut: they get the browser's own answer; the live check shows
// whether the player still ends up on H.264, and the owner checklist covers a signed-in profile).
const apply = Reflect.apply;
const resolved = Promise.resolve.bind(Promise);
let refuse = { h264: false, max30fps: false };

// Method shorthand, as the natives are: the wrapper keeps `this` (through `apply`), the native's name and its length of 1.
feature('codecs', () => {
  if (ytPage(location.href).kind === 'other') return;
  const isTypeSupported = MediaSource.isTypeSupported;
  MediaSource.isTypeSupported = {
    isTypeSupported(_type: string) {
      return refuseType(String(arguments[0]), refuse) ? false : apply(isTypeSupported, this, arguments);
    },
  }.isTypeSupported;
  const decodingInfo = MediaCapabilities.prototype.decodingInfo;
  MediaCapabilities.prototype.decodingInfo = {
    decodingInfo(_config: unknown) {
      return refuseConfig(arguments[0], refuse) ? resolved({ supported: false, smooth: false, powerEfficient: false, keySystemAccess: null }) : apply(decodingInfo, this, arguments);
    },
  }.decodingInfo;
});

// Only the page kinds that get YouTube tools: not m.youtube.com or music.youtube.com.
onSettings((s) => {
  const tools = s.on && ytPage(location.href).kind !== 'other';
  refuse = { h264: tools && s.quality.h264, max30fps: tools && s.quality.max30fps };
});
