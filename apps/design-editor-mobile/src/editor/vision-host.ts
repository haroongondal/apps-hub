import { plainError } from '../media/errors.ts';
import type { SearchToolResult } from '../photos/search-tool.ts';
import { visionToolMessage, type VisionTool } from '../photos/vision-tool.ts';

// The app's half of window.native.vision (SPEC §14.3). Pieces of 786,432 bytes = 1,048,576 base64
// chars, a multiple of 3 so their base64 joins; every path out deletes the files and pieces it made.
export const PIECE_BYTES = 786_432;
export const VISION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type VisionOp = 'cutout' | 'upscale';
export type VisionProgress = { id: string; phase: 'download' | 'run'; fraction: number };

export interface VisionHostDeps {
  dir: string;
  makeDir(): Promise<void>;
  writeBase64(uri: string, base64: string): Promise<void>;
  readBase64(uri: string, position: number, length: number): Promise<string>;
  size(uri: string): Promise<number>;
  remove(uri: string): Promise<void>;
  getTool(tool: VisionTool, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<SearchToolResult>;
  tools(): Promise<{ tool: string }[]>;
  runVision(id: string, op: VisionOp, path: string, option: string): Promise<string>;
  cancelVision(id: string): Promise<void>;
  onRunProgress(fn: (e: { id: string; fraction: number }) => void): { remove(): void };
  send(p: VisionProgress): void;
}

const OPTIONS: Record<VisionOp, string[]> = { cutout: ['person', 'object'], upscale: ['2', '4'] };
const NOT_STARTED = "This change didn't start properly. Try again.";
const DID_NOT_WORK = "This tool didn't work on this image. Try again.";
// plainError keeps a bare file path (FileNotFoundException's message); no sentence of ours has a slash
const plain = (err: unknown) => {
  const text = plainError(err, DID_NOT_WORK);
  return /[/\\]/.test(text) ? DID_NOT_WORK : text;
};

export function createVisionHost(d: VisionHostDeps) {
  const pieces = new Map<string, string[]>();
  const results = new Map<string, { uri: string; bytes: number }>();
  const running = new Set<string>();
  const cancelled = new Set<string>();
  const downloads = new Map<string, AbortController>();
  const swept = d.remove(d.dir).catch(() => {});
  const src = (id: string) => `${d.dir}${id}.src`;
  const checkId = (id: unknown): string => {
    if (typeof id !== 'string' || !VISION_ID.test(id)) throw new Error(NOT_STARTED);
    return id;
  };
  const drop = async (id: string) => {
    pieces.delete(id);
    const r = results.get(id);
    results.delete(id);
    await d.remove(src(id));
    if (r) await d.remove(r.uri);
  };

  async function cancel(rawId: string) {
    const id = checkId(rawId);
    cancelled.add(id);
    downloads.get(id)?.abort();
    try {
      await d.cancelVision(id);
    } finally {
      await drop(id);
    }
  }

  return {
    async tools(): Promise<string[]> {
      return [...new Set((await d.tools()).map(t => t.tool).filter(t => t !== 'upscale'))];
    },

    chunk(rawId: string, index: number, data: string) {
      const id = checkId(rawId);
      if (cancelled.has(id)) return false;
      if (!Number.isInteger(index) || index < 0 || typeof data !== 'string') throw new Error(NOT_STARTED);
      const list = pieces.get(id) ?? [];
      list[index] = data;
      pieces.set(id, list);
      return true;
    },

    async run(rawId: string, op: VisionOp, option: string, chunks: number): Promise<{ bytes: number } | null> {
      const id = checkId(rawId);
      const parts = pieces.get(id);
      pieces.delete(id);
      running.add(id);
      const sub = d.onRunProgress(e => {
        if (e.id === id && !cancelled.has(id)) d.send({ id, phase: 'run', fraction: e.fraction });
      });
      try {
        if (cancelled.has(id)) return null;
        if (!OPTIONS[op]?.includes(option)) throw new Error(NOT_STARTED);
        if (!parts || chunks < 1 || parts.length !== chunks || parts.includes(undefined as unknown as string)) {
          throw new Error("The image didn't arrive in full. Try again.");
        }
        await swept;
        await d.makeDir();
        await d.writeBase64(src(id), parts.join(''));
        if (cancelled.has(id)) return null;
        let downloading = false;
        const abort = new AbortController();
        downloads.set(id, abort);
        const got = await d.getTool(op === 'cutout' ? (option as VisionTool) : 'upscale', f => {
          if (f < 1) downloading = true;
          if (downloading && !cancelled.has(id)) d.send({ id, phase: 'download', fraction: f });
        }, abort.signal);
        // Cancel aborts the download, which answers 'offline': settle as cancelled, not as an error.
        if (cancelled.has(id)) return null;
        const message = visionToolMessage(got);
        if (message) throw new Error(message);
        let out: string;
        try {
          out = await d.runVision(id, op, src(id).replace(/^file:\/\//, ''), option);
        } catch (err) {
          if ((err as { code?: string })?.code === 'CANCELLED' || cancelled.has(id)) return null;
          throw err;
        }
        const uri = out.startsWith('file://') ? out : `file://${out}`;
        if (cancelled.has(id)) {
          await d.remove(uri);
          return null;
        }
        results.set(id, { uri, bytes: 0 });
        const bytes = await d.size(uri);
        results.set(id, { uri, bytes });
        return { bytes };
      } catch (err) {
        await drop(id);
        throw new Error(plain(err));
      } finally {
        sub.remove();
        running.delete(id);
        downloads.delete(id);
        await d.remove(src(id));
      }
    },

    async read(rawId: string, index: number): Promise<{ data: string; done: boolean }> {
      const id = checkId(rawId);
      const r = results.get(id);
      if (!r || !Number.isInteger(index) || index < 0) throw new Error('This change is no longer here. Try again.');
      try {
        const data = await d.readBase64(r.uri, index * PIECE_BYTES, PIECE_BYTES);
        const done = (index + 1) * PIECE_BYTES >= r.bytes;
        if (done) await drop(id);
        return { data, done };
      } catch (err) {
        await drop(id);
        throw new Error(plain(err));
      }
    },

    cancel,

    async dispose() {
      const ids = new Set([...pieces.keys(), ...results.keys(), ...running]);
      await Promise.all([...ids].map(id => cancel(id).catch(() => {})));
    },
  };
}

export type VisionHost = ReturnType<typeof createVisionHost>;
