// Renders the sample pictures from truth.json with this Mac's system fonts (4-bit grey PNG, about 10 KB each).
// Needs `npm i @napi-rs/canvas` somewhere on the module path. Usage: node render.mjs [outDir]
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { deflateSync, crc32 } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] ?? here;
const truth = JSON.parse(fs.readFileSync(path.join(here, 'truth.json'), 'utf8'));
for (const p of ['GeezaPro.ttc', 'NotoNastaliq.ttc', 'DecoTypeNastaleeqUrdu.ttc', 'Supplemental/Damascus.ttc', 'Supplemental/DecoTypeNaskh.ttc']) GlobalFonts.registerFromPath(`/System/Library/Fonts/${p}`);

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png4(w, h, rgba) {
  const stride = Math.ceil(w / 2);
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = Math.round(((rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3) / 17);
    raw[y * (stride + 1) + 1 + (x >> 1)] |= x & 1 ? v : v << 4;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 4; // 4-bit greyscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, t] of Object.entries(truth)) {
  const W = 900, lh = t.size * (t.font.includes('Nastaliq') ? 2.6 : 2.0), H = Math.round(t.lines.length * lh + 50);
  const c = createCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
  g.font = `${t.size}px "${t.font}"`; g.direction = 'rtl'; g.textAlign = 'right';
  t.lines.forEach((s, i) => g.fillText(s, W - 30, 30 + lh * (i + 0.7)));
  fs.writeFileSync(path.join(out, `${name}.png`), png4(W, H, g.getImageData(0, 0, W, H).data));
}
