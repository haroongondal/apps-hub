import { normalizeForSearch } from '@apps-hub/library-core';

import { AiError, RELATIONS, type ConceptRelation, type Extraction } from './types.ts';

/** The key concepts are matched on: "React-Native", "react native" and "REACT NATIVE" agree. */
export const normLabel = (s: string): string =>
  normalizeForSearch(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const MAX_LIST = 200;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const field = (v: unknown, key: string): unknown => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined);

/** The model's reply is untrusted: drops anything malformed and links that name unknown concepts. */
export function cleanExtraction(raw: unknown, segmentCount: number): Extraction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AiError('bad_reply', 'The model sent a reply Nexus could not read.');
  const concepts = list(field(raw, 'concepts'))
    .map((c) => ({
      label: str(field(c, 'label'), 120),
      aliases: list(field(c, 'aliases'))
        .map((a) => str(a, 120))
        .filter((a) => normLabel(a) !== ''),
    }))
    .filter((c) => normLabel(c.label) !== '');
  const conceptOf = new Map<string, number>();
  concepts.forEach((c, i) => [c.label, ...c.aliases].forEach((l) => conceptOf.set(normLabel(l), conceptOf.get(normLabel(l)) ?? i)));
  const isKnown = (label: string) => conceptOf.has(normLabel(label));

  const atoms = list(field(raw, 'atoms'))
    .map((a) => {
      const segment = field(a, 'segment');
      return {
        text: str(field(a, 'text'), 500),
        segment: Number.isInteger(segment) && (segment as number) >= 0 && (segment as number) < segmentCount ? (segment as number) : 0,
        concepts: list(field(a, 'concepts'))
          .map((l) => str(l, 120))
          .filter(isKnown),
      };
    })
    .filter((a) => a.text !== '');

  const relations = list(field(raw, 'relations'))
    .map((r) => {
      const weight = field(r, 'weight');
      return {
        from: str(field(r, 'from'), 120),
        to: str(field(r, 'to'), 120),
        type: str(field(r, 'type'), 20) as ConceptRelation,
        weight: typeof weight === 'number' && Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : 0.5,
        evidence: str(field(r, 'evidence'), 300),
      };
    })
    .filter((r) => RELATIONS.includes(r.type) && isKnown(r.from) && isKnown(r.to) && conceptOf.get(normLabel(r.from)) !== conceptOf.get(normLabel(r.to)));

  return { concepts, atoms, relations };
}
