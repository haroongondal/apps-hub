import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENTS,
  DEFAULT_YOUTUBE,
  QUALITIES,
  QUALITY_HEIGHT,
  YOUTUBE_GROUPS,
  YOUTUBE_KEY,
  getPath,
  mergeYouTube,
  setPath,
  validateYouTube,
} from '../youtube-settings.ts';
import type { Field } from '../youtube-settings.ts';

const v = (patch: unknown) => validateYouTube(patch);

test('defaults are the plan object and unusable input gives them', () => {
  assert.equal(YOUTUBE_KEY, 'youtube');
  assert.deepEqual(DEFAULT_YOUTUBE, {
    version: 1,
    on: true,
    speed: { setDefault: false, default: 1, step: 0.25, anySpeed: true, wheel: 'over-speed' },
    volume: { setDefault: false, level: 50, boostOn: false, boost: 2, step: 5, wheel: 'off' },
    reverseWheel: false,
    quality: { videos: 'auto', videosFull: 'same', playlists: 'auto', playlistsFull: 'same', embeds: 'auto', embedsFull: 'same', h264: false, max30fps: false },
    player: {
      autoTheater: false, expand: false, cinema: false, backdrop: '#000000', backdropOpacity: 85, filtersOn: false,
      filters: { blur: 0, brightness: 100, contrast: 100, grayscale: 0, hue: 0, invert: 0, saturate: 100, sepia: 0 },
    },
    autoplay: { mode: 'allow', playlists: true, pauseOthers: false },
    tidy: {
      hideShorts: false, convertShorts: false, hideRelated: false, hideComments: false, hideChat: false, newestComments: false,
      expandDescription: false, hideCards: false, perRow: { home: 0, channel: 0, shorts: 0, posts: 0 },
    },
    theme: { dark: false, accent: 'youtube', css: '' },
    experiments: { presets: [], overrides: '' },
  });
  for (const input of [undefined, 'x', { version: 2 }, null, [], 7]) assert.deepEqual(v(input), DEFAULT_YOUTUBE);
  assert.notEqual(v({ version: 1 }), DEFAULT_YOUTUBE);
  assert.notEqual(v({ version: 1 }).speed, DEFAULT_YOUTUBE.speed);
  assert.notEqual(v(undefined).experiments.presets, DEFAULT_YOUTUBE.experiments.presets);
});

test('quality lists and heights', () => {
  assert.equal(QUALITIES.length, 10);
  assert.deepEqual(QUALITIES.map((q) => QUALITY_HEIGHT[q]), [144, 240, 360, 480, 720, 1080, 1440, 2160, 2880, 4320]);
});

test('speed is rounded to two decimals and clamped to 0.1 to 16', () => {
  assert.equal(v({ speed: { default: 99 } }).speed.default, 16);
  assert.equal(v({ speed: { default: 0 } }).speed.default, 0.1);
  assert.equal(v({ speed: { default: 1.234 } }).speed.default, 1.23);
  assert.equal(v({ speed: { default: '1.5' } }).speed.default, 1);
  assert.equal(v({ speed: { default: NaN } }).speed.default, 1);
  assert.equal(v({ speed: { default: Infinity } }).speed.default, 1);
  assert.equal(v({ speed: { step: 5 } }).speed.step, 1);
  assert.equal(v({ speed: { step: 0 } }).speed.step, 0.05);
});

test('volume level, boost and step', () => {
  assert.equal(v({ volume: { level: 50.6 } }).volume.level, 51);
  assert.equal(v({ volume: { level: -3 } }).volume.level, 0);
  assert.equal(v({ volume: { boost: 0.5 } }).volume.boost, 1.1);
  assert.equal(v({ volume: { boost: 2.25 } }).volume.boost, 2.3);
  assert.equal(v({ volume: { step: 99 } }).volume.step, 20);
});

test('quality choices: unknown gives auto, same only where allowed', () => {
  assert.equal(v({ quality: { videos: 'hd9999' } }).quality.videos, 'auto');
  assert.equal(v({ quality: { videosFull: 'same' } }).quality.videosFull, 'same');
  assert.equal(v({ quality: { videosFull: 'hd1080' } }).quality.videosFull, 'hd1080');
  assert.equal(v({ quality: { videos: 'same' } }).quality.videos, 'auto');
  assert.equal(v({ quality: { embeds: 'highres' } }).quality.embeds, 'highres');
});

test('two right-button wheels: speed gives way', () => {
  const out = v({ speed: { wheel: 'right-button' }, volume: { wheel: 'right-button' } });
  assert.equal(out.speed.wheel, 'over-speed');
  assert.equal(out.volume.wheel, 'right-button');
  assert.equal(v({ speed: { wheel: 'right-button' } }).speed.wheel, 'right-button');
});

test('backdrop colour', () => {
  assert.equal(v({ player: { backdrop: '#ABCDEF' } }).player.backdrop, '#abcdef');
  assert.equal(v({ player: { backdrop: 'red' } }).player.backdrop, '#000000');
  assert.equal(v({ player: { backdrop: '#abc' } }).player.backdrop, '#000000');
});

test('filters are integers in range', () => {
  const f = v({ player: { filters: { hue: 400, saturate: -1, blur: 2.4 } } }).player.filters;
  assert.equal(f.hue, 360);
  assert.equal(f.saturate, 0);
  assert.equal(f.blur, 2);
  assert.equal(f.brightness, 100);
});

test('videos per row', () => {
  assert.equal(v({ tidy: { perRow: { home: 11 } } }).tidy.perRow.home, 10);
  assert.equal(v({ tidy: { perRow: { home: 3.6 } } }).tidy.perRow.home, 4);
});

test('theme css and accent', () => {
  assert.equal(v({ theme: { css: 'a'.repeat(100000) } }).theme.css.length, 100000);
  assert.equal(v({ theme: { css: 'a'.repeat(100001) } }).theme.css, '');
  assert.equal(v({ theme: { css: 5 } }).theme.css, '');
  assert.equal(v({ theme: { accent: 'blue' } }).theme.accent, 'blue');
  assert.equal(v({ theme: { accent: 'nope' } }).theme.accent, 'youtube');
  assert.deepEqual(ACCENTS.map((a) => a.key), ['youtube', 'red', 'pink', 'purple', 'indigo', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'grey']);
  assert.equal(ACCENTS[0].hex, null);
  assert.equal(ACCENTS[1].hex, '#e53935');
});

test('experiments presets and overrides', () => {
  assert.deepEqual(v({ experiments: { presets: ['modern-player', 'modern-player', 'Bad Id!', 'x'.repeat(41), 5] } }).experiments.presets, ['modern-player']);
  const many = Array.from({ length: 21 }, (_, i) => `p${i}`);
  assert.deepEqual(v({ experiments: { presets: many } }).experiments.presets, many.slice(0, 20));
  assert.equal(v({ experiments: { presets: 'x' } }).experiments.presets.length, 0);
  assert.equal(v({ experiments: { overrides: 'a=true' } }).experiments.overrides, 'a=true');
  assert.equal(v({ experiments: { overrides: 'a'.repeat(10001) } }).experiments.overrides, '');
});

test('on is a boolean, default true', () => {
  assert.equal(v({ on: false }).on, false);
  assert.equal(v({ on: 'no' }).on, true);
});

test('unknown keys are dropped', () => {
  assert.deepEqual(v({ extra: 1, speed: { extra: 2 } }), DEFAULT_YOUTUBE);
});

test('mergeYouTube: deep merge, arrays replaced, version ignored, then validated', () => {
  const merged = mergeYouTube(DEFAULT_YOUTUBE, { player: { cinema: true } });
  assert.deepEqual(merged, { ...DEFAULT_YOUTUBE, player: { ...DEFAULT_YOUTUBE.player, cinema: true } });
  assert.equal(mergeYouTube(DEFAULT_YOUTUBE, { volume: { level: 500 } }).volume.level, 100);
  assert.deepEqual(mergeYouTube(DEFAULT_YOUTUBE, 'x'), DEFAULT_YOUTUBE);
  assert.equal(mergeYouTube(DEFAULT_YOUTUBE, { version: 9, player: { expand: true } }).player.expand, true);
  const a = mergeYouTube(DEFAULT_YOUTUBE, { experiments: { presets: ['a'] } });
  assert.deepEqual(a.experiments.presets, ['a']);
  assert.deepEqual(mergeYouTube(a, { experiments: { presets: [] } }).experiments.presets, []);
  assert.equal(mergeYouTube(a, { speed: { default: 2 } }).experiments.presets[0], 'a');
  assert.deepEqual(DEFAULT_YOUTUBE.experiments.presets, []);
});

function leaves(o: unknown, prefix = ''): string[] {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return [prefix];
  return Object.entries(o).flatMap(([k, val]) => leaves(val, prefix ? `${prefix}.${k}` : k));
}

const fields: Field[] = YOUTUBE_GROUPS.flatMap((g) => [...g.fields]);

test('the field list covers every setting once', () => {
  const want = leaves(DEFAULT_YOUTUBE).filter((p) => p !== 'version' && p !== 'experiments.presets').sort();
  assert.deepEqual(fields.map((f) => f.path).sort(), want);
  assert.equal(fields.length, 54);
  assert.deepEqual(YOUTUBE_GROUPS.map((g) => g.id), ['tools', 'speed', 'volume', 'quality', 'player', 'autoplay', 'page', 'theme', 'experiments']);
  assert.equal(YOUTUBE_GROUPS[0].fields[0].path, 'on');
  assert.equal(YOUTUBE_GROUPS[0].fields[0].label, 'YouTube tools');
});

test('number fields clamp to their own min and max', () => {
  for (const f of fields) {
    if (f.kind !== 'number') continue;
    assert.equal(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, f.max + 1000)), f.path), f.max, f.path);
    assert.equal(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, f.min - 1000)), f.path), f.min, f.path);
  }
});

test('select fields accept every option and refuse others', () => {
  for (const f of fields) {
    if (f.kind !== 'select') continue;
    for (const o of f.options) assert.equal(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, o.value)), f.path), o.value, `${f.path}=${o.value}`);
    assert.notEqual(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, 'nope')), f.path), 'nope', f.path);
  }
});

test('text fields refuse a string one over their limit', () => {
  for (const f of fields) {
    if (f.kind !== 'text') continue;
    assert.equal(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, 'a'.repeat(f.maxLength))), f.path), 'a'.repeat(f.maxLength));
    assert.equal(getPath(v(setPath(DEFAULT_YOUTUBE, f.path, 'a'.repeat(f.maxLength + 1))), f.path), '');
  }
});

test('getPath and setPath', () => {
  assert.equal(getPath({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(getPath({ a: 1 }, 'a.b.c'), undefined);
  const input = { a: { b: 1 }, c: 3 };
  const out = setPath(input, 'a.b', 2);
  assert.deepEqual(out, { a: { b: 2 }, c: 3 });
  assert.deepEqual(input, { a: { b: 1 }, c: 3 });
});
