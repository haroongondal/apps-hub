import type { ImagePlan, MediaInfo, Planned } from './types.ts';

export interface Zlib { inflate(data: Uint8Array, maxBytes: number): Uint8Array; deflate(data: Uint8Array): Promise<Uint8Array> }

export function imageFormat(name: string): ImagePlan['format'] | undefined {
  const ext = /\.(png|jpe?g)$/i.exec(name)?.[1];
  return ext ? (ext.toLowerCase() === 'png' ? 'png' : 'jpg') : undefined;
}

export function planImage(info: MediaInfo): Planned<ImagePlan> {
  const format = imageFormat(info.name);
  if (!format) return { ok: false, reason: 'invalid', detail: 'Pick a PNG or JPEG file.' };
  return { ok: true, plan: { tool: 'image', format, ext: format } };
}

export async function optimizeImage(src: Uint8Array, format: ImagePlan['format'], z: Zlib): Promise<Uint8Array | null> {
  return format === 'png' ? optimizePng(src, z) : optimizeJpeg(src);
}

const LEFT_ALONE = 'This photo carries extra data after the picture, such as an HDR copy, so it is left as it is.';
const MAX_RAW_BYTES = 400 * 1024 * 1024;
const DAMAGED = "This image looks damaged, so it can't be compressed.";
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_KEEP = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'pHYs']);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export async function optimizePng(src: Uint8Array, z: Zlib): Promise<Uint8Array | null> {
  if (src.length < 8 || SIGNATURE.some((b, i) => src[i] !== b)) throw new Error('This file is not a PNG.');
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const kept: Uint8Array[] = [];
  const idat: Uint8Array[] = [];
  let ihdr: Uint8Array | undefined;
  let ended = false;
  for (let pos = 8; !ended && pos + 12 <= src.length;) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...src.subarray(pos + 4, pos + 8));
    if (pos + 12 + len > src.length || !/^[A-Za-z]{4}$/.test(type)) throw new Error(DAMAGED);
    const data = src.subarray(pos + 8, pos + 8 + len);
    if (type === 'acTL') throw new Error("Animated PNGs can't be compressed without losing frames.");
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') ended = true;
    else if (PNG_KEEP.has(type)) kept.push(pngChunk(type, data));
    else if (type.charCodeAt(0) < 97) throw new Error("This PNG uses a feature that can't be compressed safely.");
    pos += 12 + len;
  }
  if (!ended || !ihdr || ihdr.length !== 13 || !idat.length) throw new Error(DAMAGED);
  const head = new DataView(ihdr.buffer, ihdr.byteOffset);
  const [width, height, depth, channels] = [head.getUint32(0), head.getUint32(4), ihdr[8], CHANNELS[ihdr[9]]];
  if (!channels || !width || !height) throw new Error(DAMAGED);
  const joined = concat(idat);
  let picture = joined;
  if (ihdr[12] === 0) {
    const rowBytes = Math.ceil(width * channels * depth / 8);
    if (rowBytes * height > MAX_RAW_BYTES) throw new Error('This image is too large to shrink.');
    let raw: Uint8Array;
    try { raw = z.inflate(joined, height * (rowBytes + 1) + 1); } catch { throw new Error(DAMAGED); }
    if (raw.length !== height * (rowBytes + 1)) throw new Error(DAMAGED);
    const candidate = await z.deflate(refilter(raw, rowBytes, height, Math.max(1, (channels * depth) >> 3)));
    if (candidate.length < picture.length) picture = candidate;
  }
  const out = concat([Uint8Array.from(SIGNATURE), pngChunk('IHDR', ihdr), ...kept, pngChunk('IDAT', picture), pngChunk('IEND', new Uint8Array(0))]);
  return out.length < src.length ? out : null;
}

function predict(type: number, a: number, b: number, c: number): number {
  if (type === 1) return a;
  if (type === 2) return b;
  if (type === 3) return (a + b) >> 1;
  if (type !== 4) return 0;
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function refilter(data: Uint8Array, rowBytes: number, height: number, bpp: number): Uint8Array {
  const px = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const type = data[y * (rowBytes + 1)];
    if (type > 4) throw new Error(DAMAGED);
    const at = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? px[at + x - bpp] : 0;
      const b = y ? px[at - rowBytes + x] : 0;
      const c = y && x >= bpp ? px[at - rowBytes + x - bpp] : 0;
      px[at + x] = data[y * (rowBytes + 1) + 1 + x] + predict(type, a, b, c);
    }
  }
  const out = new Uint8Array((rowBytes + 1) * height);
  const rows = [0, 1, 2, 3, 4].map(() => new Uint8Array(rowBytes));
  for (let y = 0; y < height; y++) {
    const at = y * rowBytes;
    let best = 0;
    let bestSum = Infinity;
    for (let type = 0; type < 5; type++) {
      let sum = 0;
      const row = rows[type];
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= bpp ? px[at + x - bpp] : 0;
        const b = y ? px[at - rowBytes + x] : 0;
        const c = y && x >= bpp ? px[at - rowBytes + x - bpp] : 0;
        const v = (px[at + x] - predict(type, a, b, c)) & 255;
        row[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = type; }
    }
    out[y * (rowBytes + 1)] = best;
    out.set(rows[best], y * (rowBytes + 1) + 1);
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function optimizeJpeg(src: Uint8Array): Uint8Array | null {
  if (src.length < 4 || src[0] !== 0xff || src[1] !== 0xd8) throw new Error('This file is not a JPEG.');
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  let pos = 2;
  for (;;) {
    while (src[pos] === 0xff && src[pos + 1] === 0xff) pos++;
    if (src[pos] !== 0xff || pos + 2 > src.length) throw new Error(DAMAGED);
    const marker = src[pos + 1];
    if (marker === 0xd9) { parts.push(src.subarray(pos, pos + 2)); pos += 2; break; }
    const end = pos + 2 + ((src[pos + 2] << 8) | src[pos + 3]);
    if (end > src.length || end < pos + 4) throw new Error(DAMAGED);
    if (marker === 0xda) {
      let q = end;
      while (q + 1 < src.length && !(src[q] === 0xff && src[q + 1] !== 0 && !(src[q + 1] >= 0xd0 && src[q + 1] <= 0xd7))) q++;
      if (q + 1 >= src.length) throw new Error(DAMAGED);
      parts.push(src.subarray(pos, q));
      pos = q;
      continue;
    }
    const seg = src.subarray(pos, end);
    const droppable = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    const kept = droppable ? keepSegment(marker, seg) : seg;
    if (kept) parts.push(kept);
    pos = end;
  }
  // Bytes after the end marker hold a gain map or a second picture that the metadata points to; stripping would orphan them.
  if (pos < src.length) throw new Error(LEFT_ALONE);
  const out = concat(parts);
  return out.length < src.length ? out : null;
}

// Rotation and the colour profile change how the picture looks, so they survive; the rest of EXIF (GPS, camera) goes.
function keepSegment(marker: number, seg: Uint8Array): Uint8Array | undefined {
  if (marker === 0xe2 && String.fromCharCode(...seg.subarray(4, 15)) === 'ICC_PROFILE') return seg;
  if (marker !== 0xe1 || String.fromCharCode(...seg.subarray(4, 8)) !== 'Exif') return undefined;
  const o = exifOrientation(seg);
  if (o < 2 || o > 8) return undefined;
  return Uint8Array.from([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8,
    0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
}

function exifOrientation(seg: Uint8Array): number {
  const tiff = 10;
  const little = seg[tiff] === 0x49;
  const u16 = (i: number) => (i + 2 > seg.length ? 0 : little ? seg[i] | (seg[i + 1] << 8) : (seg[i] << 8) | seg[i + 1]);
  const [low, high] = little ? [tiff + 4, tiff + 6] : [tiff + 6, tiff + 4];
  const ifd = tiff + (u16(low) | (u16(high) << 16));
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const entry = ifd + 2 + 12 * i;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 0;
}
