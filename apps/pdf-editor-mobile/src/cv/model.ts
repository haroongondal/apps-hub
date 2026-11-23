export const TEMPLATE_IDS = ['classic', 'modern', 'minimal'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface CvEntry {
  title: string;
  subtitle: string;
  dates: string;
  lines: string[];
  plain: boolean;
}
export interface CvSection {
  heading: string;
  entries: CvEntry[];
}
/** What the AI writes. The layout is never part of it: the template is chosen by the user. */
export interface CvBody {
  name: string;
  title: string;
  contact: string[];
  sections: CvSection[];
}
export interface Cv extends CvBody {
  id: string;
  template: TemplateId;
  updated: string;
}

export const NOT_A_CV = 'The AI reply was not a CV Nexus could read. Try again.';

const LIMIT = { name: 120, title: 160, contact: 8, contactLine: 160, sections: 12, heading: 60, entries: 15, field: 200, lines: 12, line: 400 };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = <T>(v: unknown, max: number, read: (x: unknown) => T): T[] => (Array.isArray(v) ? v.slice(0, max).map(read) : []);
// The AI reply is untrusted: keep only text, drop control characters, and cut to a sane length.
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function readEntry(x: unknown): CvEntry {
  const e = obj(x);
  return {
    title: clip(e.title, LIMIT.field),
    subtitle: clip(e.subtitle, LIMIT.field),
    dates: clip(e.dates, LIMIT.field),
    lines: list(e.lines, LIMIT.lines, (l) => clip(l, LIMIT.line)).filter(Boolean),
    plain: e.plain === true,
  };
}

function readSection(x: unknown): CvSection {
  const s = obj(x);
  return {
    heading: clip(s.heading, LIMIT.heading),
    entries: list(s.entries, LIMIT.entries, readEntry).filter((e) => e.title || e.subtitle || e.dates || e.lines.length),
  };
}

export function parseBody(value: unknown): CvBody {
  const v = obj(value);
  const body: CvBody = {
    name: clip(v.name, LIMIT.name),
    title: clip(v.title, LIMIT.title),
    contact: list(v.contact, LIMIT.contact, (c) => clip(c, LIMIT.contactLine)).filter(Boolean),
    sections: list(v.sections, LIMIT.sections, readSection).filter((s) => s.heading && s.entries.length),
  };
  if (!body.name) throw new Error(NOT_A_CV);
  return body;
}

export function readBody(text: string): CvBody {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_CV);
  }
  return parseBody(value);
}
