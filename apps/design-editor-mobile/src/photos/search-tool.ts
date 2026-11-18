export interface PhotoModel { name: string; url: string; bytes: number; ready: boolean }

export interface SearchToolDeps {
  models(): Promise<PhotoModel[]>;
  download(url: string, to: string, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void>;
  install(name: string): Promise<boolean>;
  freeBytes(): Promise<number>;
  remove(path: string): Promise<void>;
}

export type SearchToolResult = 'ready' | 'no-room' | 'bad-download' | 'offline';

const SPARE_BYTES = 50 * 1024 * 1024;

export async function getSearchTool(deps: SearchToolDeps, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<SearchToolResult> {
  const missing = (await deps.models()).filter(m => !m.ready);
  const total = missing.reduce((sum, m) => sum + m.bytes, 0);
  if (total > 0 && (await deps.freeBytes()) < total + SPARE_BYTES) return 'no-room';
  let done = 0;
  for (const m of missing) {
    // An abort answers 'offline' like any download that stopped; the caller that aborted ignores the answer.
    if (signal?.aborted) return 'offline';
    const part = `models/${m.name}.part`;
    try {
      await deps.download(m.url, part, n => onProgress(Math.min(1, (done + n) / total)), signal);
      if (signal?.aborted) throw new Error('Download canceled');
    } catch {
      await deps.remove(part).catch(() => {});
      return 'offline';
    }
    if (!(await deps.install(m.name))) return 'bad-download';
    done += m.bytes;
  }
  onProgress(1);
  return 'ready';
}
