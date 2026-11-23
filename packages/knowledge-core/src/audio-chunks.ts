import { AiError, type Segment } from './types.ts';

/**
 * One piece of a recording. The four times are in the clock of the file the piece is cut from.
 * A piece planned from a `TranscribeSource` also says which file that is, where the file starts in the
 * whole recording and what the piece is (`identity`, used to tell whether a saved result still fits).
 */
export interface ChunkWindow {
  startMs: number;
  endMs: number;
  keepFromMs: number;
  keepToMs: number;
  /** Index into the source's files. */
  file?: number;
  /** Where that file starts in the whole recording. */
  offsetMs?: number;
  identity?: string;
}

export const CHUNK_OVERLAP_MS = 2_000;
const HEADROOM = 0.9; // AAC's rate varies a little, and each piece carries its own header

export function planChunks(durationMs: number, bytes: number, limit: number, overlapMs = CHUNK_OVERLAP_MS): ChunkWindow[] {
  if (!(durationMs > 0) || !(bytes > 0) || !(limit > 0)) throw new RangeError('A recording needs a length, a size and an upload limit.');
  if (bytes <= limit) return [{ startMs: 0, endMs: durationMs, keepFromMs: 0, keepToMs: durationMs }];
  const fitMs = (limit * HEADROOM * durationMs) / bytes;
  const keepMs = fitMs - 2 * overlapMs;
  if (keepMs <= 0) throw new RangeError('This recording is too dense to split under the upload limit.');
  const count = Math.ceil(durationMs / keepMs);
  const step = durationMs / count;
  return Array.from({ length: count }, (_, i) => {
    const keepFromMs = Math.round(i * step);
    const keepToMs = i === count - 1 ? durationMs : Math.round((i + 1) * step);
    return { startMs: Math.max(0, keepFromMs - overlapMs), endMs: Math.min(durationMs, keepToMs + overlapMs), keepFromMs, keepToMs };
  });
}

/** One file of a recording. `key` names the file's content (its path, size and change time, say), so a changed file reads as a new one. */
export interface SourceFile {
  key: string;
  bytes: number;
  durationMs: number;
  /** Where the file starts in the whole recording. */
  offsetMs: number;
}

/** A recording as ordered files (a single file, or the rolling segment files of a long meeting). Each file is cut on its own. */
export type TranscribeSource = readonly SourceFile[];

/** Pieces for every file of a source, in order. Each piece keeps its file's index, offset and an identity. */
export function planSource(source: TranscribeSource, limit: number, overlapMs = CHUNK_OVERLAP_MS): ChunkWindow[] {
  if (source.length === 0) throw new RangeError('A recording needs at least one file.');
  return source.flatMap((f, file) => {
    if (!(f.offsetMs >= 0) || (file > 0 && f.offsetMs < source[file - 1].offsetMs)) throw new RangeError('The files of a recording must be in order.');
    return planChunks(f.durationMs, f.bytes, limit, overlapMs).map((w) => ({
      ...w,
      file,
      offsetMs: f.offsetMs,
      identity: JSON.stringify([f.key, f.offsetMs, w.startMs, w.endMs, w.keepFromMs, w.keepToMs]),
    }));
  });
}

export interface ChunkTranscript {
  window: ChunkWindow;
  segments: Segment[];
}

const toSec = (ms: number) => Math.round(ms) / 1000;
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function stitchTranscripts(parts: ChunkTranscript[]): Segment[] {
  const out: Segment[] = [];
  parts.forEach(({ window, segments }, i) => {
    const last = i === parts.length - 1;
    for (const s of segments) {
      if (!s.locator || !('startSec' in s.locator)) {
        out.push(s);
        continue;
      }
      const startMs = window.startMs + s.locator.startSec * 1000;
      const endMs = window.startMs + s.locator.endSec * 1000;
      const midMs = (startMs + endMs) / 2;
      // a segment belongs to the piece whose keep range holds its midpoint, so the overlap counts once
      if (midMs < window.keepFromMs || (!last && midMs >= window.keepToMs)) continue;
      const offsetMs = window.offsetMs ?? 0; // from here on, times are the whole recording's
      const prev = out.at(-1);
      const prevLoc = prev?.locator;
      if (prev && prevLoc && 'startSec' in prevLoc && offsetMs + startMs < prevLoc.endSec * 1000 && sameText(prev.text, s.text)) continue;
      out.push({ text: s.text, locator: { startSec: toSec(offsetMs + startMs), endSec: toSec(offsetMs + endMs) } });
    }
  });
  return out;
}

const RETRIED: readonly string[] = ['server', 'bad_reply'];

/**
 * Where a recording's finished pieces are kept between runs, for one item (the store belongs to one recording).
 * Records are opaque text. `read` answers null when there is none. Nothing here has to be atomic: a half-written
 * or unreadable record is ignored and its piece is done again.
 */
export interface PieceStore {
  read(index: number): Promise<string | null>;
  write(index: number, record: string): Promise<void>;
  /** Removes every record of the recording. */
  clear(): Promise<void>;
}

const isSegment = (s: unknown): s is Segment => {
  const { text, locator } = (s ?? {}) as { text?: unknown; locator?: unknown };
  if (typeof text !== 'string') return false;
  if (locator === null) return true;
  const { startSec, endSec } = (locator ?? {}) as { startSec?: unknown; endSec?: unknown };
  return Number.isFinite(startSec) && Number.isFinite(endSec);
};

// A saved piece counts only when it parses, names this very piece and holds well-formed segments; anything else is redone.
async function savedPiece(store: PieceStore, index: number, identity: string): Promise<Segment[] | null> {
  try {
    const record = JSON.parse((await store.read(index)) ?? 'null') as { identity?: unknown; segments?: unknown } | null;
    if (record?.identity !== identity || !Array.isArray(record.segments) || !record.segments.every(isSegment)) return null;
    return record.segments as Segment[];
  } catch {
    return null;
  }
}

// Losing a write only loses the chance to resume; the piece's result is still in this run's hands.
async function keepPiece(store: PieceStore, index: number, identity: string, segments: Segment[]): Promise<void> {
  try {
    await store.write(index, JSON.stringify({ identity, segments }));
  } catch {
    // shortcut: a failed write is not reported, upgrade if a full disk should stop the run
  }
}

export interface ChunkedTranscription<F> {
  windows: ChunkWindow[];
  cut(window: ChunkWindow, index: number): Promise<F>;
  transcribe(file: F): Promise<Segment[]>;
  release(file: F): void | Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
  /**
   * Finished pieces are saved here as they succeed, and a piece whose saved result still fits (same `identity`)
   * is neither cut nor sent again. Every window needs an `identity` (see `planSource`). The caller clears the
   * store once the stitched transcript is safely saved.
   */
  store?: PieceStore;
  /**
   * Called before each cut and each upload attempt; it throws to stop the run (the item was taken out, say).
   * Its error passes through unchanged and the pieces already finished stay in `store`.
   */
  check?: () => Promise<void>;
}

// One piece at a time. A piece that still fails after its retries stops the run with its error; the pieces before it stay saved in `store`.
export async function transcribeInChunks<F>(o: ChunkedTranscription<F>): Promise<Segment[]> {
  const attempts = o.attempts ?? 3;
  const delayMs = o.retryDelayMs ?? 2_000;
  const parts: ChunkTranscript[] = [];
  const { store } = o;
  if (store && o.windows.some((w) => !w.identity)) throw new RangeError('Saving pieces needs every piece to have an identity.');
  let stop: unknown = null;
  const check = async () => {
    try {
      await o.check?.();
    } catch (err) {
      stop = err;
      throw err;
    }
  };
  for (const [i, window] of o.windows.entries()) {
    const which = `part ${i + 1} of ${o.windows.length}`;
    const done = store ? await savedPiece(store, i, window.identity!) : null;
    if (done) {
      parts.push({ window, segments: done });
      continue;
    }
    await check();
    let file: F;
    try {
      file = await o.cut(window, i);
    } catch (err) {
      throw new Error(`Nexus could not split this recording at ${which}. ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      for (let attempt = 1; ; attempt++) {
        await check();
        try {
          const segments = await o.transcribe(file);
          parts.push({ window, segments });
          if (store) await keepPiece(store, i, window.identity!, segments);
          break;
        } catch (err) {
          const retry = err instanceof AiError && RETRIED.includes(err.kind) && attempt < attempts;
          if (!retry) throw err;
          await new Promise((r) => setTimeout(r, delayMs * attempt));
        }
      }
    } catch (err) {
      if (err === stop) throw err;
      const message = `Nexus could not transcribe ${which} of this recording. ${err instanceof Error ? err.message : String(err)}`;
      throw err instanceof AiError ? new AiError(err.kind, message) : new Error(message);
    } finally {
      await o.release(file);
    }
  }
  return stitchTranscripts(parts);
}
