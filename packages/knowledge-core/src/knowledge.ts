import { migrate, type Item, type ItemKind, type Library, type Row, type SqlPort } from '@apps-hub/library-core';

import { chunkSegments } from './chunk.ts';
import { cleanExtraction, normLabel } from './extraction.ts';
import { KNOWLEDGE_STEPS } from './schema.ts';
import { AiError, PAUSING, type AiPort, type ContentPort, type Extraction, type Locator, type Segment } from './types.ts';
import { cosine, fromBlob, toBlob, topK } from './vectors.ts';

export type JobStage = 'text' | 'embed' | 'graph' | 'done';
export type JobStatus = 'queued' | 'running' | 'failed' | 'done';
export interface Job {
  itemId: string;
  stage: JobStage;
  status: JobStatus;
  attempts: number;
  error: string | null;
  updatedAt: number;
}
export type RunResult = 'idle' | 'ran' | 'paused';

export interface Source {
  itemId: string;
  title: string;
  kind: ItemKind;
  locator: Locator;
  text: string;
}
export interface Answer {
  text: string;
  citations: (Source & { n: number })[];
}

export interface KnowledgeDeps {
  ai: AiPort;
  content: ContentPort;
  /** Names the embedding model; when it changes, stored vectors are made again. */
  embedTag: string;
  now(): number;
  newId(): string;
}

export const STUCK_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export const MERGE_AT = 0.88;
const ASK_CHUNKS = 8;
const ASK_ATOMS = 6;
const EMBED_BATCH = 64;
// shortcut: only the first ~24k characters of an item feed the graph (Ask still searches every chunk); extract per window when long PDFs need full graphs.
const EXTRACT_CHARS = 24_000;
const NEXT: Record<Exclude<JobStage, 'done'>, JobStage> = { text: 'embed', embed: 'graph', graph: 'done' };

/** Thrown when the item was excluded or re-queued during a stage, so the stage stops before its next outbound call. */
class Withdrawn extends Error {}

const loc = (v: unknown): Locator => (typeof v === 'string' ? (JSON.parse(v) as Locator) : null);
const locJson = (l: Locator) => (l === null ? null : JSON.stringify(l));
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const srcId = (itemId: string) => `src:${itemId}`;

export function locatorLabel(l: Locator): string {
  if (l === null) return '';
  if ('page' in l) return `p. ${l.page}`;
  const s = Math.floor(l.startSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const toJob = (r: Row): Job => ({
  itemId: r.item_id as string,
  stage: r.stage as JobStage,
  status: r.status as JobStatus,
  attempts: r.attempts as number,
  error: r.error as string | null,
  updatedAt: r.updated_at as number,
});

const WALK = (starts: number) => `
WITH RECURSIVE walk(id, depth, path) AS (
  SELECT id, 0, '/' || id || '/' FROM kn_nodes WHERE id IN (${marks(starts)})
  UNION ALL
  SELECT CASE WHEN e.from_id = w.id THEN e.to_id ELSE e.from_id END, w.depth + 1,
         w.path || (CASE WHEN e.from_id = w.id THEN e.to_id ELSE e.from_id END) || '/'
  FROM walk w JOIN kn_edges e ON e.from_id = w.id OR e.to_id = w.id
  WHERE w.depth < ? AND instr(w.path, '/' || (CASE WHEN e.from_id = w.id THEN e.to_id ELSE e.from_id END) || '/') = 0
)`;

interface Concept {
  id: string;
  label: string;
  norms: Set<string>;
  embedding: Float32Array | null;
  isNew: boolean;
  changed: boolean;
}

export class Knowledge {
  readonly lib: Library;
  private readonly db: SqlPort;
  private readonly deps: KnowledgeDeps;
  private graphLock: Promise<unknown> = Promise.resolve(); // concurrent graph stages would each create the same new concept

  private constructor(lib: Library, deps: KnowledgeDeps) {
    this.lib = lib;
    this.db = lib.db;
    this.deps = deps;
  }

  static async open(lib: Library, deps: KnowledgeDeps): Promise<Knowledge> {
    await migrate(lib.db, 'knowledge', KNOWLEDGE_STEPS);
    const kn = new Knowledge(lib, deps);
    await kn.retagEmbeddings();
    return kn;
  }

  /**
   * Vectors from another embedding model can't be compared with the new ones, so they go. Segments, atoms and links stay.
   * Items that had vectors re-run from the embed stage, which then rebuilds their graph too.
   */
  private async retagEmbeddings(): Promise<void> {
    const tag = this.deps.embedTag;
    if ((await this.db.first("SELECT value FROM kn_meta WHERE key = 'embed_tag'"))?.value === tag) return;
    await this.db.transaction(async (tx) => {
      await tx.run(
        `UPDATE kn_jobs SET stage = 'embed', status = 'queued', gen = gen + 1, attempts = 0, error = NULL, updated_at = ?
         WHERE stage <> 'text' AND item_id IN (SELECT item_id FROM kn_chunks)`,
        [this.deps.now()],
      );
      await tx.run('DELETE FROM kn_chunks');
      // shortcut: concepts that existed before keep name-only matching (no vector to compare); new concepts get vectors again, upgrade by re-embedding labels here if duplicates show up.
      await tx.run("UPDATE kn_nodes SET embedding = NULL WHERE type = 'concept'");
      await tx.run("INSERT INTO kn_meta (key, value) VALUES ('embed_tag', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [tag]);
    });
  }

  async enqueue(itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (await isExcluded(tx, itemId)) return;
      await tx.run(
        `INSERT INTO kn_jobs (item_id, stage, status, updated_at) VALUES (?, 'text', 'queued', ?)
         ON CONFLICT(item_id) DO UPDATE SET stage = 'text', status = 'queued', gen = gen + 1, attempts = 0, error = NULL,
           updated_at = excluded.updated_at`,
        [itemId, this.deps.now()],
      );
    });
  }

  // Segments stay: they are the item's own transcript or OCR text. A stage already running finds no job and writes nothing.
  async exclude(itemId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT OR IGNORE INTO kn_excluded (item_id, excluded_at) VALUES (?, ?)', [itemId, this.deps.now()]);
      await tx.run('DELETE FROM kn_jobs WHERE item_id = ?', [itemId]);
      await tx.run('DELETE FROM kn_chunks WHERE item_id = ?', [itemId]);
      await tx.run('DELETE FROM kn_nodes WHERE item_id = ?', [itemId]); // the source node and its atoms; their edges go by cascade
      await tx.run('DELETE FROM kn_edges WHERE item_id = ?', [itemId]); // the links it made to concepts other items share
      await pruneConcepts(tx);
    });
  }

  async include(itemId: string): Promise<void> {
    await this.db.run('DELETE FROM kn_excluded WHERE item_id = ?', [itemId]);
    await this.enqueue(itemId);
  }

  isExcluded(itemId: string): Promise<boolean> {
    return isExcluded(this.db, itemId);
  }

  async excludedIds(): Promise<Set<string>> {
    return new Set((await this.db.all('SELECT item_id FROM kn_excluded')).map((r) => r.item_id as string));
  }

  async retry(itemId: string): Promise<void> {
    await this.db.run("UPDATE kn_jobs SET status = 'queued', attempts = 0, error = NULL WHERE item_id = ? AND status = 'failed'", [itemId]);
  }

  /** `olderThanMs` 0 on a cold start: every running job then belongs to a dead process. */
  async recover(olderThanMs = STUCK_MS): Promise<number> {
    const stuck = await this.db.all("SELECT item_id FROM kn_jobs WHERE status = 'running' AND updated_at <= ?", [this.deps.now() - olderThanMs]);
    if (stuck.length) {
      await this.db.run(`UPDATE kn_jobs SET status = 'queued', gen = gen + 1 WHERE item_id IN (${marks(stuck.length)})`, stuck.map((r) => r.item_id));
    }
    return stuck.length;
  }

  async job(itemId: string): Promise<Job | null> {
    const row = await this.db.first('SELECT * FROM kn_jobs WHERE item_id = ?', [itemId]);
    return row ? toJob(row) : null;
  }

  async summary(itemId: string): Promise<{ ideas: number; links: number }> {
    const row = await this.db.first(
      `SELECT (SELECT COUNT(*) FROM kn_nodes WHERE item_id = ? AND type = 'atom') AS ideas,
              (SELECT COUNT(*) FROM kn_edges WHERE item_id = ? AND rel <> 'PART_OF') AS links`,
      [itemId, itemId],
    );
    return { ideas: row?.ideas as number, links: row?.links as number };
  }

  async ideas(itemId: string): Promise<{ text: string; locator: Locator }[]> {
    const rows = await this.db.all("SELECT label, locator FROM kn_nodes WHERE item_id = ? AND type = 'atom' ORDER BY rowid", [itemId]);
    return rows.map((r) => ({ text: r.label as string, locator: loc(r.locator) }));
  }

  async enqueueMissing(): Promise<number> {
    const missing = await this.db.all(
      'SELECT id FROM items WHERE id NOT IN (SELECT item_id FROM kn_jobs) AND id NOT IN (SELECT item_id FROM kn_excluded)',
    );
    for (const r of missing) await this.enqueue(r.id as string);
    return missing.length;
  }

  async runNext(): Promise<RunResult> {
    const now = this.deps.now();
    const claimed = await this.db.transaction(async (tx) => {
      const row = await tx.first("SELECT item_id, stage, gen FROM kn_jobs WHERE status = 'queued' ORDER BY updated_at, item_id LIMIT 1");
      if (row) await tx.run("UPDATE kn_jobs SET status = 'running', updated_at = ? WHERE item_id = ?", [now, row.item_id]);
      return row;
    });
    if (!claimed) return 'idle';
    const itemId = claimed.item_id as string;
    const stage = claimed.stage as Exclude<JobStage, 'done'>;
    const gen = claimed.gen as number;
    const item = await this.lib.getItem(itemId);
    if (!item) return 'ran'; // deleted meanwhile: the job went with it

    try {
      if (stage === 'text') await this.textStage(item, gen);
      else if (stage === 'embed') await this.embedStage(itemId, gen);
      else await this.serialGraph(item, gen);
    } catch (e) {
      if (e instanceof Withdrawn) return 'ran';
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof AiError && PAUSING.includes(e.kind)) {
        await this.db.run("UPDATE kn_jobs SET status = 'queued', error = ? WHERE item_id = ? AND gen = ?", [message, itemId, gen]);
        return 'paused';
      }
      await this.db.run(
        `UPDATE kn_jobs SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'queued' END,
           error = ?, updated_at = ? WHERE item_id = ? AND gen = ?`,
        [MAX_ATTEMPTS, message, this.deps.now(), itemId, gen],
      );
      return 'ran';
    }
    const next = NEXT[stage];
    await this.db.run(
      'UPDATE kn_jobs SET stage = ?, status = ?, attempts = 0, error = NULL, updated_at = ? WHERE item_id = ? AND gen = ?',
      [next, next === 'done' ? 'done' : 'queued', this.deps.now(), itemId, gen],
    );
    return 'ran';
  }

  private async keep(itemId: string, gen: number): Promise<void> {
    if (!(await isLive(this.db, itemId, gen))) throw new Withdrawn('The item was taken out of Nexus.');
  }

  private async textStage(item: Item, gen: number): Promise<void> {
    await this.keep(item.id, gen); // audio and images go out to the provider inside segments()
    const segments = (await this.deps.content.segments(item)).filter((s) => s.text.trim() !== '');
    const wrote = await this.db.transaction(async (tx) => {
      if (!(await isLive(tx, item.id, gen))) return false;
      await tx.run('DELETE FROM kn_segments WHERE item_id = ?', [item.id]);
      for (const [seq, s] of segments.entries()) {
        await tx.run('INSERT INTO kn_segments (item_id, seq, text, locator) VALUES (?, ?, ?, ?)', [item.id, seq, s.text, locJson(s.locator)]);
      }
      return true;
    });
    if (wrote && (item.kind === 'audio' || item.kind === 'image')) await this.lib.setBody(item.id, segments.map((s) => s.text).join('\n')); // so Library search finds transcripts and OCR
  }

  async segmentsOf(itemId: string): Promise<Segment[]> {
    const rows = await this.db.all('SELECT text, locator FROM kn_segments WHERE item_id = ? ORDER BY seq', [itemId]);
    return rows.map((r) => ({ text: r.text as string, locator: loc(r.locator) }));
  }

  private async embedStage(itemId: string, gen: number): Promise<void> {
    const chunks = chunkSegments(await this.segmentsOf(itemId));
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      await this.keep(itemId, gen);
      vectors.push(...(await this.deps.ai.embed(chunks.slice(i, i + EMBED_BATCH).map((c) => c.text))));
    }
    if (vectors.length !== chunks.length) throw new AiError('bad_reply', 'The model sent the wrong number of embeddings.');
    await this.db.transaction(async (tx) => {
      if (!(await isLive(tx, itemId, gen))) return;
      await tx.run('DELETE FROM kn_chunks WHERE item_id = ?', [itemId]);
      for (const [seq, c] of chunks.entries()) {
        await tx.run('INSERT INTO kn_chunks (item_id, seq, text, locator, embedding) VALUES (?, ?, ?, ?, ?)', [
          itemId,
          seq,
          c.text,
          locJson(c.locator),
          toBlob(vectors[seq]),
        ]);
      }
    });
  }

  private serialGraph(item: Item, gen: number): Promise<void> {
    const run = this.graphLock.then(() => this.graphStage(item, gen));
    this.graphLock = run.catch(() => {});
    return run;
  }

  private async graphStage(item: Item, gen: number): Promise<void> {
    const segments = await this.segmentsOf(item.id);
    const input: string[] = [];
    let chars = 0;
    for (const s of segments) {
      if (input.length && chars + s.text.length > EXTRACT_CHARS) break;
      input.push(s.text.slice(0, EXTRACT_CHARS));
      chars += s.text.length;
    }
    await this.keep(item.id, gen);
    const ex: Extraction = input.length ? cleanExtraction(await this.deps.ai.extract(input), input.length) : { concepts: [], atoms: [], relations: [] };
    await this.keep(item.id, gen);
    const { idOf, touched } = await this.resolve(ex.concepts);
    const now = this.deps.now();
    const src = srcId(item.id);

    await this.db.transaction(async (tx) => {
      if (!(await isLive(tx, item.id, gen))) return;
      await tx.run('DELETE FROM kn_edges WHERE item_id = ?', [item.id]);
      await tx.run("DELETE FROM kn_nodes WHERE item_id = ? AND type = 'atom'", [item.id]);
      await tx.run(
        `INSERT INTO kn_nodes (id, type, item_id, label, created_at) VALUES (?, 'source', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label`,
        [src, item.id, item.title, now],
      );
      for (const c of touched) {
        const [norm, ...aliases] = [...c.norms];
        if (c.isNew) {
          await tx.run("INSERT INTO kn_nodes (id, type, label, norm, aliases, embedding, created_at) VALUES (?, 'concept', ?, ?, ?, ?, ?)", [
            c.id,
            c.label,
            norm,
            JSON.stringify(aliases),
            c.embedding ? toBlob(c.embedding) : null,
            now,
          ]);
        } else {
          await tx.run('UPDATE kn_nodes SET aliases = ? WHERE id = ?', [JSON.stringify(aliases), c.id]);
        }
      }
      const edge = (from: string, to: string, rel: string, weight: number, evidence: string | null = null) =>
        from === to
          ? Promise.resolve()
          : tx.run('INSERT OR IGNORE INTO kn_edges (from_id, to_id, rel, weight, item_id, evidence) VALUES (?, ?, ?, ?, ?, ?)', [
              from,
              to,
              rel,
              weight,
              item.id,
              evidence,
            ]);
      for (const c of ex.concepts) await edge(src, idOf(c.label), 'MENTIONS', 0.5);
      for (const [i, a] of ex.atoms.entries()) {
        const atomId = `${item.id}:${i}`;
        await tx.run("INSERT INTO kn_nodes (id, type, item_id, label, locator, created_at) VALUES (?, 'atom', ?, ?, ?, ?)", [
          atomId,
          item.id,
          a.text,
          locJson(segments[a.segment]?.locator ?? null),
          now,
        ]);
        await edge(atomId, src, 'PART_OF', 1);
        for (const label of a.concepts) await edge(atomId, idOf(label), 'MENTIONS', 0.7);
      }
      for (const r of ex.relations) await edge(idOf(r.from), idOf(r.to), r.type, r.weight, r.evidence || null);
      await pruneConcepts(tx);
    });
  }

  private async resolve(extracted: Extraction['concepts']) {
    const rows = await this.db.all("SELECT id, label, norm, aliases, embedding FROM kn_nodes WHERE type = 'concept'");
    const pool: Concept[] = rows.map((r) => ({
      id: r.id as string,
      label: r.label as string,
      norms: new Set([r.norm as string, ...(JSON.parse(r.aliases as string) as string[])]),
      embedding: r.embedding instanceof Uint8Array ? fromBlob(r.embedding) : null,
      isNew: false,
      changed: false,
    }));
    const byNorm = new Map<string, Concept>();
    for (const c of pool) for (const n of c.norms) byNorm.set(n, c);
    const absorb = (c: Concept, norms: string[]) => {
      for (const n of norms) {
        const owner = byNorm.get(n);
        if (owner && owner !== c) continue; // "React" stays React's even when "React Native" lists it as an alias
        if (!c.norms.has(n)) {
          c.norms.add(n);
          c.changed = true;
        }
        byNorm.set(n, c);
      }
    };

    const pending: { label: string; norms: string[] }[] = [];
    for (const e of extracted) {
      const norms = [...new Set([e.label, ...e.aliases].map(normLabel))];
      const hit = norms.map((n) => byNorm.get(n)).find((c) => c !== undefined);
      if (hit) absorb(hit, norms);
      else pending.push({ label: e.label, norms });
    }
    const vectors = pending.length ? await this.deps.ai.embed(pending.map((p) => p.label)) : [];
    for (const [i, p] of pending.entries()) {
      const exact = p.norms.map((n) => byNorm.get(n)).find((c) => c !== undefined); // an earlier pending label of this batch
      const [best] = exact ? [] : topK(pool.filter((c) => c.embedding), (c) => cosine(vectors[i], c.embedding as Float32Array), 1);
      const hit = exact ?? (best && best.score >= MERGE_AT ? best.item : undefined);
      if (hit) absorb(hit, p.norms);
      else {
        const c: Concept = { id: this.deps.newId(), label: p.label, norms: new Set(p.norms), embedding: vectors[i] ?? null, isNew: true, changed: true };
        pool.push(c);
        absorb(c, p.norms);
      }
    }
    const idOf = (label: string) => (byNorm.get(normLabel(label)) as Concept).id;
    return { idOf, touched: pool.filter((c) => c.isNew || c.changed) };
  }

  async related(itemId: string, limit = 5): Promise<{ item: Item; score: number }[]> {
    const rows = await this.db.all(
      `${WALK(1)} SELECT n.item_id, COUNT(*) AS score FROM walk JOIN kn_nodes n ON n.id = walk.id
       WHERE n.type IN ('source', 'atom') AND n.item_id <> ? GROUP BY n.item_id ORDER BY score DESC, n.item_id LIMIT ?`,
      [srcId(itemId), 2, itemId, limit],
    );
    const out: { item: Item; score: number }[] = [];
    for (const r of rows) {
      const item = await this.lib.getItem(r.item_id as string);
      if (item) out.push({ item, score: r.score as number });
    }
    return out;
  }

  async ask(question: string): Promise<Answer> {
    const q = question.trim();
    const [qv] = await this.deps.ai.embed([q]);
    // shortcut: brute-force cosine over every chunk; fine to ~20k chunks, switch to sqlite-vec beyond that.
    const rows = await this.db.all('SELECT c.item_id, c.text, c.locator, c.embedding, i.title, i.kind FROM kn_chunks c JOIN items i ON i.id = c.item_id');
    const hits = topK(rows, (r) => cosine(qv, fromBlob(r.embedding as Uint8Array)), ASK_CHUNKS).filter((h) => h.score > 0);
    const hitItems = [...new Set(hits.map((h) => h.item.item_id as string))];
    const atoms = hitItems.length
      ? await this.db.all(
          `${WALK(hitItems.length)} SELECT n.item_id, n.label, n.locator, i.title, i.kind, MIN(walk.depth) AS d, COUNT(*) AS c
           FROM walk JOIN kn_nodes n ON n.id = walk.id JOIN items i ON i.id = n.item_id
           WHERE n.type = 'atom' AND n.item_id NOT IN (${marks(hitItems.length)})
           GROUP BY n.id ORDER BY d, c DESC, n.id LIMIT ?`,
          [...hitItems.map(srcId), 2, ...hitItems, ASK_ATOMS],
        )
      : [];
    const sources: Source[] = [
      ...hits.map(({ item: r }) => ({ itemId: r.item_id as string, title: r.title as string, kind: r.kind as ItemKind, locator: loc(r.locator), text: r.text as string })),
      ...atoms.map((r) => ({ itemId: r.item_id as string, title: r.title as string, kind: r.kind as ItemKind, locator: loc(r.locator), text: r.label as string })),
    ];
    if (!sources.length) return { text: 'Nothing in your library matches that yet.', citations: [] };

    const text = await this.deps.ai.answer(
      q,
      sources.map((s) => `${s.title}${s.locator ? ` (${locatorLabel(s.locator)})` : ''}: ${s.text}`),
    );
    const cited: number[] = [];
    for (const m of text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
      for (const n of m[1].split(',').map(Number)) if (n >= 1 && n <= sources.length && !cited.includes(n)) cited.push(n);
    }
    return { text, citations: cited.map((n) => ({ n, ...sources[n - 1] })) };
  }
}

// A run whose job was re-queued (an edit, or recover after a kill) must not overwrite newer results.
const isLive = async (tx: SqlPort, itemId: string, gen: number) => (await tx.first('SELECT gen FROM kn_jobs WHERE item_id = ?', [itemId]))?.gen === gen;
const isExcluded = async (db: SqlPort, itemId: string) => (await db.first('SELECT 1 FROM kn_excluded WHERE item_id = ?', [itemId])) !== null;

export const pruneConcepts = (db: SqlPort) =>
  db.run(
    `DELETE FROM kn_nodes WHERE type = 'concept'
     AND NOT EXISTS (SELECT 1 FROM kn_edges WHERE from_id = kn_nodes.id)
     AND NOT EXISTS (SELECT 1 FROM kn_edges WHERE to_id = kn_nodes.id)`,
  );
