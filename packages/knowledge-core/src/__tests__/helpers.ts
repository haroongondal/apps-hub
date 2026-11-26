import { DatabaseSync } from 'node:sqlite';

import { Library, serialPort, type Item, type RawSql, type Row, type SqlValue } from '@apps-hub/library-core';

import { Knowledge } from '../knowledge.ts';
import type { AnswerOptions } from '../prompts.ts';
import type { AiPort, ContentPort, Segment } from '../types.ts';

// Copied from library-core's test driver (test helpers aren't exported across packages).
export function nodeRawSql(): RawSql {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const plain = (row: unknown): Row => ({ ...(row as Row) });
  return {
    run: (sql, params) => {
      db.prepare(sql).run(...(params as SqlValue[]));
    },
    all: (sql, params) => db.prepare(sql).all(...(params as SqlValue[])).map(plain),
    first: (sql, params) => {
      const row = db.prepare(sql).get(...(params as SqlValue[]));
      return row === undefined ? null : plain(row);
    },
    exec: (sql) => {
      db.exec(sql);
    },
  };
}

/** Bag of words hashed into 32 dims: texts that share words score high, others near 0. */
export function bagVector(text: string): Float32Array {
  const v = new Float32Array(32);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
    v[h % 32] += 1;
  }
  return v;
}

export interface FakeAi extends AiPort {
  calls: { embed: number; extract: number; answer: number };
  vectors: Map<string, number[]>;
  onExtract: (segments: string[]) => unknown;
  onAnswer: (question: string, sources: string[]) => string;
  lastAnswerOpts: AnswerOptions | undefined;
  fail: Error | null;
}

export function fakeAi(): FakeAi {
  const ai: FakeAi = {
    calls: { embed: 0, extract: 0, answer: 0 },
    vectors: new Map(),
    onExtract: () => ({ concepts: [], atoms: [], relations: [] }),
    onAnswer: () => 'An answer [1].',
    lastAnswerOpts: undefined,
    fail: null,
    async embed(texts) {
      ai.calls.embed++;
      if (ai.fail) throw ai.fail;
      return texts.map((t) => (ai.vectors.has(t) ? Float32Array.from(ai.vectors.get(t)!) : bagVector(t)));
    },
    async extract(segments) {
      ai.calls.extract++;
      if (ai.fail) throw ai.fail;
      return ai.onExtract(segments);
    },
    async answer(question, sources, opts) {
      ai.calls.answer++;
      ai.lastAnswerOpts = opts;
      if (ai.fail) throw ai.fail;
      return ai.onAnswer(question, sources);
    },
  };
  return ai;
}

export async function setup() {
  const db = serialPort(nodeRawSql());
  let n = 0;
  const clock = { now: 1_000_000 };
  const deps = { now: () => clock.now, newId: () => (++n).toString(36).padStart(16, '0') };
  const lib = await Library.open(db, deps);
  const ai = fakeAi();
  const texts = new Map<string, Segment[]>();
  const content: ContentPort & { hook: ((item: Item) => Promise<void>) | null } = {
    hook: null,
    async segments(item) {
      await content.hook?.(item);
      return texts.get(item.id) ?? [];
    },
  };
  const kn = await Knowledge.open(lib, { ai, content, embedTag: 'test-model', ...deps });
  const add = async (title: string, segments: Segment[] | string, kind: Item['kind'] = 'note') => {
    const item = await lib.createItem({ kind, title });
    texts.set(item.id, typeof segments === 'string' ? [{ text: segments, locator: null }] : segments);
    await kn.enqueue(item.id);
    return item;
  };
  const drain = async () => {
    while ((await kn.runNext()) === 'ran');
  };
  return { db, lib, kn, ai, content, texts, clock, add, drain };
}
