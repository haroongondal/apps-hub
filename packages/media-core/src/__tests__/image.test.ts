import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { test } from 'node:test';
import { imageFormat, optimizeImage, optimizeJpeg, optimizePng, planImage } from '../image.ts';
import { validateSpec } from '../validate.ts';
import type { MediaInfo } from '../types.ts';

const z = { inflate: (b: Uint8Array) => zlib.inflateSync(b), deflate: (b: Uint8Array) => zlib.deflateSync(b, { level: 9 }) };
const SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function makePng(width: number, height: number, colorType: number, depth: number, pixels: Uint8Array, extra: Buffer[] = [], interlace = 0): Buffer {
  const rowBytes = Math.ceil(width * CHANNELS[colorType] * depth / 8);
  const filtered = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) filtered.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, colorType, 0, 0, interlace], 8);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(filtered, { level: 1 })), chunk('IEND', new Uint8Array(0))]);
}

function decode(png: Uint8Array): Uint8Array {
  const buf = Buffer.from(png);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const [depth, colorType] = [buf[24], buf[25]];
  const idat: Buffer[] = [];
  for (let pos = 8; pos < buf.length; pos += 12 + buf.readUInt32BE(pos)) {
    if (buf.toString('latin1', pos + 4, pos + 8) === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + buf.readUInt32BE(pos)));
  }
  const data = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width * CHANNELS[colorType] * depth / 8);
  const bpp = Math.max(1, CHANNELS[colorType] * depth >> 3);
  const px = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rowBytes; x++) {
      const f = data[y * (rowBytes + 1)];
      const a = x >= bpp ? px[y * rowBytes + x - bpp] : 0;
      const b = y ? px[(y - 1) * rowBytes + x] : 0;
      const c = y && x >= bpp ? px[(y - 1) * rowBytes + x - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * rowBytes + x] = (data[y * (rowBytes + 1) + 1 + x] + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
  }
  return px;
}

function gradient(rowBytes: number, height: number): Uint8Array {
  const px = new Uint8Array(rowBytes * height);
  let seed = 7;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = ((i % rowBytes) * 3 + Math.floor(i / rowBytes) * 2 + (seed >> 28)) & 255;
  }
  return px;
}

for (const [colorType, depth] of [[0, 8], [2, 8], [4, 8], [6, 8], [2, 16], [3, 4], [0, 1]]) {
  test(`png: color type ${colorType} at ${depth} bits keeps every pixel and gets smaller`, () => {
    const [width, height] = [61, 40];
    const pixels = gradient(Math.ceil(width * CHANNELS[colorType] * depth / 8), height);
    const text = chunk('tEXt', Buffer.from('Comment\0made by a test, with some padding to weigh something'));
    const plte = colorType === 3 ? [chunk('PLTE', new Uint8Array(48))] : [];
    const src = makePng(width, height, colorType, depth, pixels, [...plte, text]);
    const out = optimizePng(src, z);
    assert.ok(out, 'expected a smaller file');
    assert.ok(out.length < src.length);
    assert.deepEqual(decode(out), pixels);
    assert.equal(Buffer.from(out).includes('tEXt'), false);
    assert.equal(Buffer.from(out).includes('PLTE'), colorType === 3);
  });
}

test('png: a second pass finds nothing more to save', () => {
  const once = optimizePng(makePng(64, 64, 6, 8, gradient(256, 64)), z)!;
  assert.equal(optimizePng(once, z), null);
});

test('png: colour chunks survive and timestamps go', () => {
  const src = makePng(8, 8, 2, 8, gradient(24, 8), [chunk('gAMA', new Uint8Array(4)), chunk('iCCP', Buffer.from('p\0\0abc')), chunk('tIME', new Uint8Array(7))]);
  const out = Buffer.from(optimizePng(src, z)!);
  assert.ok(out.includes('gAMA') && out.includes('iCCP'));
  assert.equal(out.includes('tIME'), false);
});

test('png: an interlaced file keeps its picture data and loses only the extra chunks', () => {
  const src = makePng(8, 8, 2, 8, gradient(24, 8), [chunk('tEXt', Buffer.from('Comment\0'.repeat(30)))], 1);
  const out = optimizePng(src, z)!;
  assert.ok(out.length < src.length);
  assert.equal(Buffer.from(out).includes('tEXt'), false);
});

test('png: refusals say what is wrong', () => {
  assert.throws(() => optimizePng(Uint8Array.from([1, 2, 3]), z), /not a PNG/);
  const good = makePng(8, 8, 2, 8, gradient(24, 8));
  assert.throws(() => optimizePng(good.subarray(0, good.length - 30), z), /damaged/);
  const animated = makePng(8, 8, 2, 8, gradient(24, 8), [chunk('acTL', new Uint8Array(8))]);
  assert.throws(() => optimizePng(animated, z), /Animated/);
});

function seg(marker: number, payload: number[]): number[] {
  return [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
}
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
function exif(orientation: number, little: boolean): number[] {
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, 0, 0] : [0, 0, (n >> 8) & 255, n & 255]);
  const tiff = [...ascii(little ? 'II' : 'MM'), ...u16(42), ...u32(8), ...u16(2),
    ...u16(0x010f), ...u16(2), ...u32(0), ...u32(0), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  return seg(0xe1, [...ascii('Exif'), 0, 0, ...tiff, ...new Array(500).fill(7)]);
}
const SCAN = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
const TABLE = seg(0xdb, [0, ...new Array(64).fill(8)]);
function jpeg(...parts: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat(), ...SCAN, 0xff, 0xd9]);
}
const find = (data: Uint8Array, bytes: number[]) => Buffer.from(data).indexOf(Buffer.from(bytes));

test('jpeg: metadata goes and the picture data is copied byte for byte', () => {
  const src = jpeg(seg(0xe0, ascii('JFIF\0')), exif(1, true), seg(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...new Array(300).fill(1)]),
    seg(0xfe, ascii('hello')), TABLE, seg(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]));
  const out = optimizeJpeg(src)!;
  assert.ok(out.length < src.length - 700);
  assert.equal(find(out, [0xff, 0xe1]), -1);
  assert.equal(find(out, [0xff, 0xfe]), -1);
  assert.ok(find(out, [0xff, 0xe0]) > 0 && find(out, TABLE) > 0 && find(out, [0xff, 0xc0]) > 0);
  assert.deepEqual([...out.subarray(find(out, SCAN))], [...src.subarray(find(src, SCAN))]);
});

test('jpeg: rotation survives in a minimal EXIF, in either byte order', () => {
  for (const little of [true, false]) {
    const out = optimizeJpeg(jpeg(exif(6, little), TABLE))!;
    const at = find(out, [0xff, 0xe1]);
    assert.ok(at > 0);
    assert.equal((out[at + 2] << 8) | out[at + 3], 34);
    assert.deepEqual([...out.subarray(at + 20, at + 30)], [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6]);
  }
});

test('jpeg: the colour profile survives', () => {
  const profile = seg(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, ...new Array(40).fill(9)]);
  assert.ok(find(optimizeJpeg(jpeg(profile, exif(1, true)))!, profile) > 0);
});

test('jpeg: a file with a picture after the end marker is left alone', () => {
  assert.equal(optimizeJpeg(Uint8Array.from([...jpeg(exif(1, true)), ...jpeg(TABLE)])), null);
});

test('jpeg: a file with no metadata has nothing to gain, and bad files are refused', () => {
  assert.equal(optimizeJpeg(jpeg(TABLE)), null);
  assert.throws(() => optimizeJpeg(Uint8Array.from([1, 2, 3, 4])), /not a JPEG/);
  assert.throws(() => optimizeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), /damaged/);
});

test('image: the plan follows the extension, and the validator keeps images and video apart', () => {
  const info = (name: string, container: MediaInfo['container']): MediaInfo => ({ id: 'a', name, bytes: 9, durationS: 0, container, tracks: [] });
  assert.equal(imageFormat('Shot.JPEG'), 'jpg');
  assert.equal(imageFormat('shot.png'), 'png');
  assert.equal(imageFormat('shot.gif'), undefined);
  assert.deepEqual(planImage(info('shot.jpeg', 'image')), { ok: true, plan: { tool: 'image', format: 'jpg', ext: 'jpg' } });
  assert.equal(planImage(info('shot.gif', 'image')).ok, false);
  assert.deepEqual(validateSpec({ tool: 'image', inputId: 'a' }, info('shot.png', 'image'), 'mac'), []);
  assert.deepEqual(validateSpec({ tool: 'quality', inputId: 'a', preset: 'high' }, info('shot.png', 'image'), 'mac'), ['This file is an image. Use Compress image.']);
  assert.deepEqual(validateSpec({ tool: 'image', inputId: 'a' }, info('clip.mp4', 'mp4'), 'mac'), ['Pick a PNG or JPEG file for this tool.']);
  assert.ok(optimizeImage(makePng(8, 8, 2, 8, gradient(24, 8), [chunk('tEXt', Buffer.from('a\0b'.repeat(20)))]), 'png', z));
  assert.equal(optimizeImage(jpeg(TABLE), 'jpg', z), null);
});
