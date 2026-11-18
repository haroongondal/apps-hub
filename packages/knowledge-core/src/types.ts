import type { Item } from '@apps-hub/library-core';

export type Locator = { page: number } | { startSec: number; endSec: number } | null;

export interface Segment {
  text: string;
  locator: Locator;
}

export const RELATIONS = ['SUPPORTS', 'CONTRADICTS', 'PART_OF', 'EXTENDS', 'INSPIRED_BY', 'SIMILAR_TO'] as const;
export type ConceptRelation = (typeof RELATIONS)[number];
export type Relation = ConceptRelation | 'MENTIONS';

export interface Extraction {
  concepts: { label: string; aliases: string[] }[];
  atoms: { text: string; segment: number; concepts: string[] }[];
  relations: { from: string; to: string; type: ConceptRelation; weight: number; evidence: string }[];
}

export interface AiPort {
  embed(texts: string[]): Promise<Float32Array[]>;
  /** The reply is untrusted: the pipeline runs it through `cleanExtraction`. */
  extract(segments: string[]): Promise<unknown>;
  answer(question: string, sources: string[]): Promise<string>;
}

export interface ContentPort {
  segments(item: Item): Promise<Segment[]>;
}

export type AiErrorKind = 'auth' | 'offline' | 'rate' | 'server' | 'bad_request' | 'bad_reply';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

// These wait for the owner or the network, so they pause the queue without using up an attempt.
export const PAUSING: readonly AiErrorKind[] = ['auth', 'offline', 'rate'];
