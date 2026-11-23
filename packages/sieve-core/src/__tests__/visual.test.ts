import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backdropColor, filterCss, flipTransform } from '../visual.ts';
import { DEFAULT_YOUTUBE } from '../youtube-settings.ts';

const f = (over: Partial<typeof DEFAULT_YOUTUBE.player.filters>) => ({ ...DEFAULT_YOUTUBE.player.filters, ...over });

test('filterCss: the defaults give none, and only changed values are listed', () => {
  assert.equal(filterCss(DEFAULT_YOUTUBE.player.filters), 'none');
  assert.equal(filterCss(f({ blur: 2, hue: 90 })), 'blur(2px) hue-rotate(90deg)');
  assert.equal(filterCss(f({ brightness: 120 })), 'brightness(120%)');
});

test('filterCss: every filter, in the order blur, brightness, contrast, grayscale, hue, invert, saturate, sepia', () => {
  assert.equal(
    filterCss({ blur: 1, brightness: 90, contrast: 110, grayscale: 20, hue: 30, invert: 40, saturate: 150, sepia: 60 }),
    'blur(1px) brightness(90%) contrast(110%) grayscale(20%) hue-rotate(30deg) invert(40%) saturate(150%) sepia(60%)',
  );
  assert.equal(filterCss(f({ brightness: 0, saturate: 0 })), 'brightness(0%) saturate(0%)');
});

test('flipTransform: the four states', () => {
  assert.equal(flipTransform(false, false), 'none');
  assert.equal(flipTransform(true, false), 'scale(-1, 1)');
  assert.equal(flipTransform(false, true), 'scale(1, -1)');
  assert.equal(flipTransform(true, true), 'scale(-1, -1)');
});

test('backdropColor: hex and percent give rgba', () => {
  assert.equal(backdropColor('#336699', 50), 'rgba(51, 102, 153, 0.5)');
  assert.equal(backdropColor('#000000', 85), 'rgba(0, 0, 0, 0.85)');
  assert.equal(backdropColor('#ffffff', 100), 'rgba(255, 255, 255, 1)');
  assert.equal(backdropColor('#ffffff', 0), 'rgba(255, 255, 255, 0)');
});

test('backdropColor: a bad colour or opacity falls back to the default backdrop', () => {
  assert.equal(backdropColor('red', 50), 'rgba(0, 0, 0, 0.5)');
  assert.equal(backdropColor('#336699', 500), 'rgba(51, 102, 153, 1)');
  assert.equal(backdropColor('#336699', Number.NaN), 'rgba(51, 102, 153, 0.85)');
});
