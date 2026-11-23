import { AiError, type Segment } from './types.ts';

export interface ChunkWindow {
  startMs: number;
  endMs: number;
  keepFromMs: number;
  keepToMs: number;
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
      const prev = out.at(-1);
      const prevLoc = prev?.locator;
      if (prev && prevLoc && 'startSec' in prevLoc && startMs < prevLoc.endSec * 1000 && sameText(prev.text, s.text)) continue;
      out.push({ text: s.text, locator: { startSec: toSec(startMs), endSec: toSec(endMs) } });
    }
  });
  return out;
}

const RETRIED: readonly string[] = ['server', 'bad_reply'];

export interface ChunkedTranscription<F> {
  windows: ChunkWindow[];
  cut(window: ChunkWindow, index: number): Promise<F>;
  transcribe(file: F): Promise<Segment[]>;
  release(file: F): void | Promise<void>;
  attempts?: number;
  retryDelayMs?: number;
}

// One piece at a time; a piece that still fails after its retries fails the whole recording, so nothing partial is kept.
export async function transcribeInChunks<F>(o: ChunkedTranscription<F>): Promise<Segment[]> {
  const attempts = o.attempts ?? 3;
  const delayMs = o.retryDelayMs ?? 2_000;
  const parts: ChunkTranscript[] = [];
  for (const [i, window] of o.windows.entries()) {
    const which = `part ${i + 1} of ${o.windows.length}`;
    let file: F;
    try {
      file = await o.cut(window, i);
    } catch (err) {
      throw new Error(`Nexus could not split this recording at ${which}. ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          parts.push({ window, segments: await o.transcribe(file) });
          break;
        } catch (err) {
          const retry = err instanceof AiError && RETRIED.includes(err.kind) && attempt < attempts;
          if (!retry) throw err;
          await new Promise((r) => setTimeout(r, delayMs * attempt));
        }
      }
    } catch (err) {
      const message = `Nexus could not transcribe ${which} of this recording. ${err instanceof Error ? err.message : String(err)}`;
      throw err instanceof AiError ? new AiError(err.kind, message) : new Error(message);
    } finally {
      await o.release(file);
    }
  }
  return stitchTranscripts(parts);
}
