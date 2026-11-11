import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipFromMatrix, isPngDataUrl, screenshotName } from '../screenshot.ts';

test('screenshotName: title and time', () => {
  assert.equal(screenshotName('Rick Astley - Never Gonna Give You Up (Official Video)', 3723), 'Rick Astley - Never Gonna Give You Up (Official Video) 1-02-03.png');
  assert.equal(screenshotName('x', 5), 'x 0-05.png');
  assert.equal(screenshotName('x', 65.9), 'x 1-05.png', 'whole seconds');
  assert.equal(screenshotName('x', Number.NaN), 'x 0-00.png');
});

test('screenshotName: path characters, controls, dots and length cannot change the folder or the name', () => {
  assert.equal(screenshotName('a/b:c*?"<>|d', 5), 'a b c d 0-05.png');
  assert.equal(screenshotName('a\\b', 5), 'a b 0-05.png');
  assert.equal(screenshotName('../../etc/passwd', 5), 'etc passwd 0-05.png');
  assert.equal(screenshotName('', 5), 'YouTube video 0-05.png');
  assert.equal(screenshotName('  //  ', 5), 'YouTube video 0-05.png');
  assert.equal(screenshotName('...hidden', 5), 'hidden 0-05.png');
  assert.equal(screenshotName('a'.repeat(300), 5), 'a'.repeat(120) + ' 0-05.png');
  assert.equal(screenshotName('a'.repeat(119) + ' b', 5), 'a'.repeat(119) + ' 0-05.png', 'a cut that ends in a space leaves one space');
  assert.equal(screenshotName('\u0000ctrl', 1), 'ctrl 0-01.png');
  assert.equal(screenshotName('a\tb\nc', 1), 'a b c 0-01.png');
  assert.equal(screenshotName('😀'.repeat(200), 1), '😀'.repeat(120) + ' 0-01.png', 'a cut never splits a character');
});

test('isPngDataUrl', () => {
  assert.equal(isPngDataUrl('data:image/png;base64,iVBORw0KGgo=', 1000), true);
  assert.equal(isPngDataUrl('data:image/jpeg;base64,/9j/4AAQ', 1000), false);
  assert.equal(isPngDataUrl('data:image/png,iVBORw0KGgo=', 1000), false, 'not base64');
  assert.equal(isPngDataUrl('https://x/a.png', 1000), false);
  assert.equal(isPngDataUrl(42, 1000), false);
  assert.equal(isPngDataUrl(null, 1000), false);
  const url = 'data:image/png;base64,' + 'A'.repeat(100);
  assert.equal(isPngDataUrl(url, url.length), true);
  assert.equal(isPngDataUrl(url, url.length - 1), false, 'longer than maxBytes');
});

test('flipFromMatrix', () => {
  assert.deepEqual(flipFromMatrix('none'), { h: false, v: false });
  assert.deepEqual(flipFromMatrix(''), { h: false, v: false });
  assert.deepEqual(flipFromMatrix('matrix(-1, 0, 0, 1, 0, 0)'), { h: true, v: false });
  assert.deepEqual(flipFromMatrix('matrix(1, 0, 0, -1, 0, 0)'), { h: false, v: true });
  assert.deepEqual(flipFromMatrix('matrix(-1, 0, 0, -1, 0, 0)'), { h: true, v: true });
  assert.deepEqual(flipFromMatrix('matrix3d(-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'), { h: true, v: true });
  assert.deepEqual(flipFromMatrix('garbage'), { h: false, v: false });
});
