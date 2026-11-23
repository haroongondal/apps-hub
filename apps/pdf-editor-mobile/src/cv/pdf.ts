import type { CvBody, CvEntry } from './model.ts';
import type { Rgb, Template } from './templates.ts';

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const BULLET_INDENT = 12;
const LEADING = 1.3;

type Weight = 'regular' | 'bold' | 'italic';
type Place = 'left' | 'center' | 'right';
interface Style {
  family: 'serif' | 'sans';
  weight: Weight;
  size: number;
  color: Rgb;
}

const FONT_NAMES: Record<string, string> = {
  'serif-regular': 'Times-Roman',
  'serif-bold': 'Times-Bold',
  'serif-italic': 'Times-Italic',
  'sans-regular': 'Helvetica',
  'sans-bold': 'Helvetica-Bold',
  'sans-italic': 'Helvetica-Oblique',
};
const FACES = Object.keys(FONT_NAMES);

// shortcut: widths are estimated per character, not read from font metrics, so lines wrap a little early; upgrade to AFM widths if ragged.
const WIDTH: Record<string, number> = {
  'serif-regular': 0.48,
  'serif-bold': 0.53,
  'serif-italic': 0.46,
  'sans-regular': 0.55,
  'sans-bold': 0.6,
  'sans-italic': 0.55,
};

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80,
  0x2026: 0x85,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2122: 0x99,
};

export function toWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    const code = cp < 0x80 || (cp >= 0xa0 && cp <= 0xff) ? cp : WIN_ANSI_EXTRA[cp];
    out += String.fromCharCode(code ?? 0x3f);
  }
  return out;
}

const escapeText = (s: string) => toWinAnsi(s).replace(/[\\()]/g, '\\$&');
const num = (x: number) => (Math.round(x * 100) / 100).toString();
const color = (c: Rgb, op: 'rg' | 'RG') => `${num(c[0])} ${num(c[1])} ${num(c[2])} ${op}`;

export function wrap(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next) <= maxW) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    let rest = word;
    while (measure(rest) > maxW && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxW) n--;
      out.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    cur = rest;
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

class Layout {
  readonly pages: string[][] = [[]];
  top = MARGIN;
  private readonly t: Template;

  constructor(t: Template) {
    this.t = t;
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1];
  }

  measure(s: string, st: Style): number {
    return [...s].length * st.size * WIDTH[`${st.family}-${st.weight}`];
  }

  private need(h: number) {
    if (this.top + h <= PAGE_H - MARGIN) return;
    this.pages.push([]);
    this.top = MARGIN;
  }

  private draw(s: string, st: Style, x: number) {
    const font = FACES.indexOf(`${st.family}-${st.weight}`) + 1;
    this.ops.push(`${color(st.color, 'rg')} BT /F${font} ${num(st.size)} Tf ${num(x)} ${num(PAGE_H - this.top - st.size)} Td (${escapeText(s)}) Tj ET`);
  }

  private x(w: number, place: Place): number {
    if (place === 'center') return (PAGE_W - w) / 2;
    if (place === 'right') return PAGE_W - MARGIN - w;
    return MARGIN;
  }

  line(s: string, st: Style, place: Place = 'left') {
    this.need(st.size * LEADING);
    this.draw(s, st, this.x(this.measure(s, st), place));
    this.top += st.size * LEADING;
  }

  bulleted(text: string, st: Style, bullet: boolean) {
    const indent = bullet ? BULLET_INDENT : 0;
    wrap(text, CONTENT_W - indent, (s) => this.measure(s, st)).forEach((l, i) => {
      this.need(st.size * LEADING);
      if (bullet && i === 0) this.draw('•', st, MARGIN);
      this.draw(l, st, MARGIN + indent);
      this.top += st.size * LEADING;
    });
  }

  entry(e: CvEntry) {
    const t = this.t;
    const body: Style = { family: t.family, weight: 'regular', size: t.bodySize, color: t.ink };
    if (e.title || e.dates) {
      this.need(t.bodySize * LEADING);
      if (e.title) this.draw(e.title, { ...body, weight: 'bold' }, MARGIN);
      if (e.dates) this.draw(e.dates, body, this.x(this.measure(e.dates, body), 'right'));
      this.top += t.bodySize * LEADING;
    }
    if (e.subtitle) this.line(e.subtitle, { ...body, weight: 'italic', color: t.muted });
    for (const l of e.lines) this.bulleted(l, body, !e.plain);
    this.top += 3;
  }

  band(c: Rgb, h: number) {
    this.ops.push(`${color(c, 'rg')} 0 ${num(PAGE_H - h)} ${num(PAGE_W)} ${num(h)} re f`);
    this.top += h;
  }

  rule() {
    const y = num(PAGE_H - this.top);
    this.ops.push(`${color(this.t.accent, 'RG')} 0.6 w ${MARGIN} ${y} m ${num(PAGE_W - MARGIN)} ${y} l S`);
    this.top += 4;
  }
}

function layout(cv: CvBody, t: Template): string[] {
  const p = new Layout(t);
  const style = (size: number, weight: Weight = 'regular', c = t.ink): Style => ({ family: t.family, weight, size, color: c });
  if (t.band) {
    p.band(t.band, 14);
    p.top += 8;
  }
  if (cv.name) p.line(cv.name, style(t.nameSize, 'bold'), t.align);
  if (cv.title) p.line(cv.title, style(t.bodySize + 1, 'regular', t.muted), t.align);
  const contact = style(t.bodySize - 0.5, 'regular', t.muted);
  if (cv.contact.length) {
    for (const l of wrap(cv.contact.join('  |  '), CONTENT_W, (s) => p.measure(s, contact))) p.line(l, contact, t.align);
  }
  for (const s of cv.sections) {
    p.top += 10;
    p.line(t.headingUpper ? s.heading.toUpperCase() : s.heading, style(t.headingSize, 'bold', t.accent));
    if (t.headingRule) p.rule();
    for (const e of s.entries) p.entry(e);
  }
  return p.pages.map((ops) => ops.join('\n'));
}

export function buildPdf(contents: string[], title: string): string {
  const firstPage = 4 + FACES.length;
  const fontRes = FACES.map((_, i) => `/F${i + 1} ${4 + i} 0 R`).join(' ');
  const kids = contents.map((_, i) => `${firstPage + 2 * i} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${contents.length} >>`,
    `<< /Title (${escapeText(title)}) /Producer (Nexus) >>`,
    ...FACES.map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[f]} /Encoding /WinAnsiEncoding >>`),
  ];
  for (const c of contents) {
    const contentId = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${c.length} >>\nstream\n${c}\nendstream`,
    );
  }

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export function renderCvPdf(cv: CvBody, t: Template): string {
  return buildPdf(layout(cv, t), `${cv.name} CV`);
}
