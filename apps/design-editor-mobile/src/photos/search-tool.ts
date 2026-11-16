export interface PhotoModel { name: string; url: string; bytes: number; ready: boolean }

export interface SearchToolDeps {
  models(): Promise<PhotoModel[]>;
  download(url: string, to: string, onBytes: (n: number) => void): Promise<void>;
  install(name: string): Promise<boolean>;
  freeBytes(): Promise<number>;
}

export type SearchToolResult = 'ready' | 'no-room' | 'bad-download';

const SPARE_BYTES = 50 * 1024 * 1024;

export async function getSearchTool(deps: SearchToolDeps, onProgress: (fraction: number) => void): Promise<SearchToolResult> {
  const missing = (await deps.models()).filter(m => !m.ready);
  const total = missing.reduce((sum, m) => sum + m.bytes, 0);
  if (total > 0 && (await deps.freeBytes()) < total + SPARE_BYTES) return 'no-room';
  let done = 0;
  for (const m of missing) {
    await deps.download(m.url, `models/${m.name}.part`, n => onProgress(Math.min(1, (done + n) / total)));
    if (!(await deps.install(m.name))) return 'bad-download';
    done += m.bytes;
  }
  onProgress(1);
  return 'ready';
}
