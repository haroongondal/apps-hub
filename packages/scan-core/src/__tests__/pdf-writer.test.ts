import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeScanPdf } from '../pdf-writer.ts';
import type { PageImage, PdfPage } from '../pdf-writer.ts';
import type { OcrWord } from '../types.ts';
import { TINY_JPEG, checkXref, latin1, memorySink } from './helpers.ts';

const jpegPage = (words: OcrWord[] = [], image: PageImage = { kind: 'jpeg', bytes: TINY_JPEG }): PdfPage => ({
  image: async () => image,
  words,
  widthPt: 595.28,
  heightPt: 841.89,
});
const info = { title: 'Receipt é', created: new Date(Date.UTC(2026, 10, 18, 9, 5, 7)) };

test('a two-page JPEG document has a valid xref and untouched image bytes', async () => {
  const sink = memorySink();
  const { bytes } = await writeScanPdf([jpegPage(), jpegPage()], sink, info);
  const pdf = sink.text();
  assert.equal(bytes, pdf.length);
  assert.ok(pdf.startsWith('%PDF-1.7\n'));
  assert.ok(pdf.endsWith('%%EOF\n'));
  assert.equal(checkXref(pdf), 10 + 3 * 2);
  assert.match(pdf, /\/Count 2/);
  assert.match(pdf, /\/Kids \[10 0 R 13 0 R\]/);
  assert.match(pdf, /\/Filter \/DCTDecode/);
  assert.match(pdf, /\/ColorSpace \/DeviceRGB/);
  assert.ok(pdf.includes(latin1(TINY_JPEG)));
  assert.ok(!pdf.includes('GlyphLessFont'), 'no font without words');
  assert.ok(pdf.includes('/Title <FEFF0052006500630065006900700074002000E9>'));
  assert.match(pdf, /\/CreationDate \(D:20261118090507Z\)/);
  assert.match(pdf, /12 0 obj/);
  assert.match(pdf, /15 0 obj/);
});

test('a bits page is a one-bit Flate gray image', async () => {
  const sink = memorySink();
  await writeScanPdf([jpegPage([], { kind: 'bits', bytes: Uint8Array.from([120, 156, 1]), width: 2480, height: 3508 })], sink, info);
  const pdf = sink.text();
  assert.match(pdf, /\/Width 2480/);
  assert.match(pdf, /\/BitsPerComponent 1/);
  assert.match(pdf, /\/Filter \/FlateDecode/);
  assert.match(pdf, /\/ColorSpace \/DeviceGray/);
  checkXref(pdf);
});

test('words add the glyphless font set and an invisible text layer', async () => {
  const sink = memorySink();
  const words: OcrWord[] = [
    { t: 'Hi', b: [0.1, 0.1, 0.2, 0.15], c: 90, l: 0 },
    { t: 'you', b: [0.25, 0.1, 0.4, 0.15], c: 90, l: 0 },
    { t: 'flat', b: [0.1, 0.2, 0.3, 0.2], c: 90, l: 1 },
  ];
  await writeScanPdf([jpegPage(words)], sink, info);
  const pdf = sink.text();
  assert.match(pdf, /\/BaseFont \/GlyphLessFont/);
  assert.match(pdf, /\/Length1 573/);
  assert.equal(checkXref(pdf), 13);
  assert.ok(pdf.includes('3 Tr'));
  assert.ok(pdf.includes('<004800690020> Tj'));
  assert.ok(pdf.includes('<0079006F0075> Tj'));
  assert.ok(!pdf.includes('<0066006C00610074>'), 'a word with zero height is skipped');
  assert.equal((pdf.match(/BT 3 Tr/g) ?? []).length, 1);
});

test('a CMYK JPEG makes the writer throw', async () => {
  const cmyk = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1, 4, 1, 17, 0, 2, 17, 0, 3, 17, 0, 4, 17, 0, 0xff, 0xd9]);
  await assert.rejects(writeScanPdf([jpegPage([], { kind: 'jpeg', bytes: cmyk })], memorySink(), info), /CMYK/);
});
