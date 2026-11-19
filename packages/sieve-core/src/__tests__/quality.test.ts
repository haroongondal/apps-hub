import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaType, pickQuality, qualityContext, qualityTarget, refuseConfig, refuseType } from '../quality.ts';
import { DEFAULT_YOUTUBE } from '../youtube-settings.ts';
import { ytPage } from '../yt-bridge.ts';

const q = (over: Partial<typeof DEFAULT_YOUTUBE.quality>) => ({ ...DEFAULT_YOUTUBE.quality, ...over });
const H264 = { h264: true, max30fps: false };
const FPS = { h264: false, max30fps: true };
const OFF = { h264: false, max30fps: false };

test('qualityContext: watch page, playlist and embed', () => {
  assert.equal(qualityContext(ytPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ')), 'videos');
  assert.equal(qualityContext(ytPage('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLsieve')), 'playlists');
  assert.equal(qualityContext(ytPage('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')), 'embeds');
  assert.equal(qualityContext(ytPage('https://www.youtube.com/embed/dQw4w9WgXcQ?list=PLsieve')), 'embeds');
});

test('qualityTarget: outside and inside full screen', () => {
  const s = q({ videos: 'hd720' });
  assert.equal(qualityTarget('videos', false, s), 'hd720');
  assert.equal(qualityTarget('videos', true, s), 'hd720');
  assert.equal(qualityTarget('videos', true, q({ videos: 'hd720', videosFull: 'hd1080' })), 'hd1080');
  assert.equal(qualityTarget('videos', false, q({ videos: 'hd720', videosFull: 'hd1080' })), 'hd720');
  assert.equal(qualityTarget('videos', true, q({ videos: 'auto', videosFull: 'same' })), 'auto');
  assert.equal(qualityTarget('videos', true, q({ videos: 'hd720', videosFull: 'auto' })), 'auto');
  assert.equal(qualityTarget('playlists', true, q({ playlists: 'large', playlistsFull: 'hd1440' })), 'hd1440');
  assert.equal(qualityTarget('embeds', false, q({ embeds: 'medium', embedsFull: 'hd1080' })), 'medium');
});

test('pickQuality: the highest label at or below the target, else the lowest offered', () => {
  const list = ['hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
  assert.equal(pickQuality(list, 'hd1440'), 'hd1080');
  assert.equal(pickQuality(list, 'large'), 'large');
  assert.equal(pickQuality(list, 'highres'), 'hd1080');
  assert.equal(pickQuality(['hd720', 'large'], 'tiny'), 'large');
  assert.equal(pickQuality([], 'hd720'), null);
  assert.equal(pickQuality(['auto', 'weird'], 'hd720'), null);
  // order of the offer does not matter, and a label the list lacks falls to the next one down
  assert.equal(pickQuality(['tiny', 'hd1080', 'medium'], 'hd720'), 'medium');
  // inspected 2026-11-10, signed out, Chrome for Testing 149.0.7827.55: dQw4w9WgXcQ offers this list
  assert.equal(pickQuality(['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'], 'hd2880'), 'hd2160');
});

test('parseMediaType: mime, codecs and the other parameters', () => {
  assert.deepEqual(parseMediaType('video/mp4; codecs="avc1.640028, mp4a.40.2"; framerate=30'), { mime: 'video/mp4', codecs: ['avc1.640028', 'mp4a.40.2'], params: { framerate: '30' } });
  assert.deepEqual(parseMediaType('Video/WebM;Codecs=vp9'), { mime: 'video/webm', codecs: ['vp9'], params: {} });
  assert.deepEqual(parseMediaType('video/mp4; codecs=av01.0.05M.08'), { mime: 'video/mp4', codecs: ['av01.0.05m.08'], params: {} });
  assert.deepEqual(parseMediaType('audio/webm; codecs="opus"; channels=2'), { mime: 'audio/webm', codecs: ['opus'], params: { channels: '2' } });
  assert.deepEqual(parseMediaType(''), { mime: '', codecs: [], params: {} });
  assert.deepEqual(parseMediaType('video/mp4'), { mime: 'video/mp4', codecs: [], params: {} });
});

test('refuseType with H.264 only: VP8, VP9 and AV1 video is refused, nothing else', () => {
  assert.equal(refuseType('video/webm; codecs="vp9"', H264), true);
  assert.equal(refuseType('video/webm; codecs="vp8"', H264), true);
  assert.equal(refuseType('video/webm; codecs="vp09.00.51.08.01.01.01.01.00"', H264), true);
  assert.equal(refuseType('video/mp4; codecs="av01.0.08M.08"', H264), true);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"', H264), false);
  assert.equal(refuseType('audio/webm; codecs="opus"', H264), false);
  assert.equal(refuseType('audio/mp4; codecs="mp4a.40.2"', H264), false);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028, vp9"', H264), true);
});

test('refuseType with 30 fps: only a video framerate above 30 is refused', () => {
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"; framerate=60', FPS), true);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"; framerate=30', FPS), false);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"; framerate=29.97', FPS), false);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"; framerate=30.5', FPS), true);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"', FPS), false);
  assert.equal(refuseType('video/mp4; codecs="avc1.640028"; framerate=abc', FPS), false);
  assert.equal(refuseType('audio/webm; codecs="opus"; framerate=60', FPS), false);
  assert.equal(refuseType('video/webm; codecs="vp9"', FPS), false);
});

test('refuseType with both off, and with odd input, refuses nothing', () => {
  assert.equal(refuseType('video/webm; codecs="vp9"; framerate=60', OFF), false);
  assert.equal(refuseType('', H264), false);
  assert.equal(refuseType('', { h264: true, max30fps: true }), false);
  assert.equal(refuseType('garbage;;==;', { h264: true, max30fps: true }), false);
  assert.equal(refuseType(undefined as unknown as string, { h264: true, max30fps: true }), false);
});

// The strings below are what the player passed to MediaSource.isTypeSupported on a signed-out watch page,
// inspected 2026-11-10, Chrome for Testing 149.0.7827.55 (dQw4w9WgXcQ, hard load).
test('refuseType on the strings the player really asks about', () => {
  const asked: [string, boolean, boolean][] = [
    // [type, refused with H.264 only, refused with 30 fps only]
    ['video/webm; codecs="vp09.02.51.10.01.09.16.09.00"', true, false],
    ['video/webm; codecs="vp09.02.51.10.01.09.99.99.00"', true, false],
    ['video/mp4; codecs="avc1.42001E"; decode-to-texture=true', false, false],
    ['video/mp4; codecs="avc1.42001E"', false, false],
    ['audio/mp4; codecs="mp4a.40.2"', false, false],
    ['audio/webm; codecs="opus"', false, false],
    ['audio/webm; codecs="opus"; channels=2', false, false],
    ['audio/webm; codecs="opus"; channels=99', false, false],
    ['video/mp4; codecs=av01.0.05M.08', true, false],
    ['video/mp4; codecs=av99.0.05M.08', false, false],
    ['video/webm; codecs="vp9"', true, false],
    ['video/webm; codecs="vp9"; height=360', true, false],
    ['video/webm; codecs="vp9"; height=99999', true, false],
    ['video/webm; codecs="vp9"; width=640', true, false],
    ['video/webm; codecs="vp9"; width=99999', true, false],
    ['video/webm; codecs="vp9"; framerate=30', true, false],
    ['video/webm; codecs="vp9"; framerate=9999', true, true],
    ['video/webm; codecs="vp9"; width=3840; height=2160; bitrate=2000000', true, false],
    ['video/webm; codecs="vp9"; width=3840; height=2160; bitrate=20000000', true, false],
    ['video/webm; codecs="vp9"; bitrate=300000', true, false],
  ];
  for (const [type, h264, fps] of asked) {
    assert.equal(refuseType(type, H264), h264, `H.264 only: ${type}`);
    assert.equal(refuseType(type, FPS), fps, `30 fps: ${type}`);
  }
});

// decodingInfo configurations the player passed, same inspection (the first call came before #movie_player existed).
const video = (contentType: string, framerate: number) => ({ type: 'media-source', video: { contentType, width: 3840, height: 2160, bitrate: 32_000_000, framerate } });

test('refuseConfig on the decodingInfo configurations the player really passes', () => {
  const av1_60 = video('video/mp4; codecs="av01.0.12M.08"', 60);
  const vp9_25 = video('video/webm; codecs="vp09.00.51.08.01.01.01.01.00"', 25);
  const av1_25 = video('video/mp4; codecs="av01.0.00M.08"', 25);
  assert.equal(refuseConfig(av1_60, H264), true);
  assert.equal(refuseConfig(av1_60, FPS), true);
  assert.equal(refuseConfig(av1_60, OFF), false);
  assert.equal(refuseConfig(vp9_25, H264), true);
  assert.equal(refuseConfig(vp9_25, FPS), false);
  assert.equal(refuseConfig(av1_25, H264), true);
  assert.equal(refuseConfig(av1_25, FPS), false);
});

test('refuseConfig: H.264 video and audio, and anything that is not a configuration, are left alone', () => {
  assert.equal(refuseConfig(video('video/mp4; codecs="avc1.640028"', 60), H264), false);
  assert.equal(refuseConfig(video('video/mp4; codecs="avc1.640028"', 60), FPS), true);
  assert.equal(refuseConfig(video('video/mp4; codecs="avc1.640028"', 30), FPS), false);
  assert.equal(refuseConfig({ type: 'media-source', audio: { contentType: 'audio/webm; codecs="opus"' } }, H264), false);
  for (const junk of [undefined, null, 'x', 5, [], {}, { video: null }, { video: 'x' }, { video: {} }, { video: { contentType: 5, framerate: 'x' } }]) {
    assert.equal(refuseConfig(junk, { h264: true, max30fps: true }), false, JSON.stringify(junk));
  }
  assert.equal(refuseConfig(video('video/mp4; codecs="avc1.640028"', '60' as unknown as number), FPS), true);
});
