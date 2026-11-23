import type { TemplateId } from './model.ts';

export type Rgb = readonly [number, number, number];

export interface Template {
  id: TemplateId;
  label: string;
  blurb: string;
  family: 'serif' | 'sans';
  align: 'center' | 'left';
  /** A full-width bar across the top of the first page. */
  band: Rgb | null;
  ink: Rgb;
  muted: Rgb;
  /** Headings, and the rule under them where the template draws one. */
  accent: Rgb;
  nameSize: number;
  headingSize: number;
  bodySize: number;
  headingUpper: boolean;
  headingRule: boolean;
}

const BLACK: Rgb = [0, 0, 0];
const GREY: Rgb = [0.33, 0.33, 0.33];

export const TEMPLATES: Record<TemplateId, Template> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    blurb: 'One column, serif type, rules under headings. Suits any field.',
    family: 'serif',
    align: 'center',
    band: null,
    ink: BLACK,
    muted: GREY,
    accent: BLACK,
    nameSize: 22,
    headingSize: 11,
    bodySize: 10.5,
    headingUpper: true,
    headingRule: true,
  },
  modern: {
    id: 'modern',
    label: 'Modern',
    blurb: 'Teal band and sans-serif type. Suits design and product roles.',
    family: 'sans',
    align: 'left',
    band: [0.05, 0.42, 0.47],
    ink: [0.07, 0.12, 0.16],
    muted: GREY,
    accent: [0.05, 0.42, 0.47],
    nameSize: 24,
    headingSize: 11,
    bodySize: 10,
    headingUpper: false,
    headingRule: false,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Plain left-aligned text with no graphics. Reads well in applicant tracking systems.',
    family: 'sans',
    align: 'left',
    band: null,
    ink: BLACK,
    muted: GREY,
    accent: BLACK,
    nameSize: 20,
    headingSize: 10.5,
    bodySize: 10,
    headingUpper: true,
    headingRule: false,
  },
};

export const TEMPLATE_LIST: Template[] = [TEMPLATES.classic, TEMPLATES.modern, TEMPLATES.minimal];
