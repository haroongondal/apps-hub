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
  /** `check` throws once the item is taken out of Nexus or re-queued; long work (a recording sent in pieces) calls it before each outbound call. */
  segments(item: Item, check?: () => Promise<void>): Promise<Segment[]>;
  /** Called after the item's segments are saved, so work kept only to finish them (saved transcript pieces) can go. A failure here is ignored. */
  saved?(item: Item): Promise<void>;
  /** Called when the item is kept out of Nexus, so that work (saved transcript pieces) goes too. A failure here is ignored. */
  withdrawn?(itemId: string): Promise<void>;
}

export type AiErrorKind = 'auth' | 'offline' | 'rate' | 'unanswered' | 'server' | 'bad_request' | 'bad_reply';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

// These wait for the owner or the network, so they pause the queue without using up an attempt.
export const PAUSING: readonly AiErrorKind[] = ['auth', 'offline', 'rate', 'unanswered'];

// 'unanswered' (AI hub said its service failed: offline, refused, unreadable) may be a failure that never clears, so its pauses are counted.
export const BOUNDED_PAUSE: readonly AiErrorKind[] = ['unanswered'];
export const MAX_PAUSES = 5;
