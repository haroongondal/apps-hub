import { CID_TO_GID_FLATE, GLYPHLESS_TTF } from './glyphless-font.ts';
import { jpegInfo } from './jpeg.ts';
import type { ByteSink, OcrWord } from './types.ts';

export type { ByteSink };
export type PageImage =
  | { kind: 'jpeg'; bytes: Uint8Array }
  | { kind: 'bits'; bytes: Uint8Array; width: number; height: number };
export interface PdfPage {
  image(): Promise<PageImage>;
  words: readonly OcrWord[];
  widthPt: number;
  heightPt: number;
}

const FIRST_PAGE_OBJ = 10;
const FLUSH_AT = 64 * 1024;

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** One UTF-16 code unit per CID, big-endian, as hex. */
const utf16Hex = (s: string, bom = false): string => {
  let hex = bom ? 'FEFF' : '';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return hex;
};

/** At most 2 decimals, never exponent notation. */
const num = (x: number): string => {
  const s = (Math.round(x * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

const pdfDate = (d: Date): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo',
  '<<',
  '  /Registry (Adobe)',
  '  /Ordering (UCS)',
  '  /Supplement 0',
  '>> def',
  '/CMapName /Adobe-Identify-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '1 beginbfrange',
  '<0000> <FFFF> <0000>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
  '',
].join('\n');

/** Text layer for one page: one BT 3 Tr block per line, words sized to their OCR boxes. */
function textLayer(words: readonly OcrWord[], W: number, H: number): string {
  let out = '';
  let i = 0;
  while (i < words.length) {
    let j = i;
    while (j + 1 < words.length && words[j + 1].l === words[i].l) j++;
    let line = '';
    for (let k = i; k <= j; k++) {
      const { t, b } = words[k];
      const last = k === j;
      const fs = (b[3] - b[1]) * H;
      const x = b[0] * W;
      const text = t + (last ? '' : ' ');
      const span = (last ? b[2] : words[k + 1].b[0]) * W - x;
      if (fs < 1 || span <= 0 || text.length === 0) continue;
      const tz = (100 * span) / (fs * 0.5 * text.length);
      line += `/F0 ${num(fs)} Tf ${num(tz)} Tz 1 0 0 1 ${num(x)} ${num(H - b[3] * H)} Tm <${utf16Hex(text)}> Tj\n`;
    }
    if (line) out += `BT 3 Tr\n${line}ET\n`;
    i = j + 1;
  }
  return out;
}

/** Streams a PDF 1.7 file to `sink`; one page's image bytes are held at a time (SPEC §8). */
export async function writeScanPdf(
  pages: readonly PdfPage[],
  sink: ByteSink,
  info: { title: string; created: Date },
): Promise<{ bytes: number }> {
  const withFonts = pages.some((p) => p.words.length > 0);
  const objCount = FIRST_PAGE_OBJ + 3 * pages.length;
  const offsets: (number | null)[] = new Array(objCount).fill(null);
  let offset = 0;
  let parts: Uint8Array[] = [];
  let buffered = 0;

  const flush = async () => {
    if (!buffered) return;
    const joined = new Uint8Array(buffered);
    let at = 0;
    for (const part of parts) (joined.set(part, at), (at += part.length));
    parts = [];
    buffered = 0;
    await sink.write(joined);
  };
  const emit = async (bytes: Uint8Array) => {
    parts.push(bytes);
    buffered += bytes.length;
    offset += bytes.length;
    if (buffered >= FLUSH_AT) await flush();
  };
  const text = (s: string) => emit(ascii(s));
  const begin = (n: number) => {
    offsets[n] = offset;
    return text(`${n} 0 obj\n`);
  };
  const streamObj = async (n: number, dict: string, data: Uint8Array) => {
    await begin(n);
    await text(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    await emit(data);
    await text('\nendstream\nendobj\n');
  };

  await emit(Uint8Array.from([...ascii('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  await begin(1);
  await text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  await begin(2);
  const kids = pages.map((_, i) => `${FIRST_PAGE_OBJ + 3 * i} 0 R`).join(' ');
  await text(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);
  await begin(3);
  await text(
    `<< /Title <${utf16Hex(info.title, true)}> /Producer (PDF Editor) /CreationDate (${pdfDate(info.created)}) >>\nendobj\n`,
  );

  if (withFonts) {
    await begin(4);
    await text('<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 9 0 R >>\nendobj\n');
    await begin(5);
    await text(
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLessFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 6 0 R /DW 500 /CIDToGIDMap 8 0 R >>\nendobj\n',
    );
    await begin(6);
    await text(
      '<< /Type /FontDescriptor /FontName /GlyphLessFont /Flags 5 /FontBBox [0 0 500 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 /FontFile2 7 0 R >>\nendobj\n',
    );
    await streamObj(7, `/Length1 ${GLYPHLESS_TTF.length}`, GLYPHLESS_TTF);
    await streamObj(8, '/Filter /FlateDecode', CID_TO_GID_FLATE);
    await streamObj(9, '', ascii(TO_UNICODE));
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageObj = FIRST_PAGE_OBJ + 3 * i;
    const W = num(page.widthPt);
    const H = num(page.heightPt);
    const font = page.words.length ? ' /Font << /F0 4 0 R >>' : '';
    await begin(pageObj);
    await text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${pageObj + 2} 0 R >>${font} >> /Contents ${pageObj + 1} 0 R >>\nendobj\n`,
    );
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n${textLayer(page.words, page.widthPt, page.heightPt)}`;
    await streamObj(pageObj + 1, '', ascii(content));

    const image = await page.image();
    let dict: string;
    if (image.kind === 'jpeg') {
      const { width, height, components } = jpegInfo(image.bytes);
      const space = components === 3 ? '/DeviceRGB' : '/DeviceGray';
      dict = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode`;
    } else {
      dict = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`;
    }
    await begin(pageObj + 2);
    await text(`<< ${dict} /Length ${image.bytes.length} >>\nstream\n`);
    await flush();
    await sink.write(image.bytes);
    offset += image.bytes.length;
    await text('\nendstream\nendobj\n');
  }

  const xrefAt = offset;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let n = 1; n < objCount; n++) {
    const at = offsets[n];
    xref += at === null ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  await text(`${xref}trailer\n<< /Size ${objCount} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  await flush();
  return { bytes: offset };
}
