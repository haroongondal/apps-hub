import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jpegInfo } from '../jpeg.ts';

const jpeg = (width: number, height: number, components: number) =>
  Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // an APP0 segment to skip
    0xff, 0xc0, 0x00, 8 + 3 * components, 8, height >> 8, height & 255, width >> 8, width & 255, components,
    ...Array.from({ length: components * 3 }, () => 0),
    0xff, 0xd9,
  ]);

test('reads size and components from the first SOF', () => {
  assert.deepEqual(jpegInfo(jpeg(200, 300, 3)), { width: 200, height: 300, components: 3 });
  assert.deepEqual(jpegInfo(jpeg(70000 % 65536, 258, 1)), { width: 4464, height: 258, components: 1 });
});

test('rejects CMYK and non-JPEG bytes', () => {
  assert.throws(() => jpegInfo(jpeg(10, 10, 4)), /unsupported JPEG: CMYK/);
  assert.throws(() => jpegInfo(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /not a JPEG/);
  assert.throws(() => jpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), /not a JPEG/);
  assert.throws(() => jpegInfo(new Uint8Array(0)), /not a JPEG/);
});
