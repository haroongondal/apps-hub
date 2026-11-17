// The ports the download engine reaches the platform through (types only). Implemented in apps/sieve, faked in tests.
import type { DlRecord } from './dl-record.ts';
import type { DownloadSettings } from './dl-settings.ts';

export interface Store {                                   // IndexedDB `sieve-dl`
  all(): Promise<DlRecord[]>;
  put(record: DlRecord, options?: { strict?: boolean }): Promise<void>;   // resolves when the transaction is durable; strict opens it with { durability: 'strict' } (the engine uses it for every put of a take-over record)
  delete(id: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}
export interface FileHandle {
  existingSize: number | null;                             // the file's size before open set its length; null when the file did not exist
  write(chunk: Uint8Array, at: number): void;              // throws on failure (disk full)
  flush(): void;
  size(): number;
  truncate(length: number): void;                          // cuts (or grows) the file to exactly length bytes
  close(): void;
}
export interface Files {                                   // OPFS root
  open(name: string, length: number | null): Promise<FileHandle>;   // creates the file if missing; a length sets its size to exactly that many bytes (grow or shrink), null keeps it
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<void>;                     // missing file: no error
  list(): Promise<string[]>;
  space(): Promise<{ quota: number; usage: number }>;
}
export interface NetResponse { status: number; url: string; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }
export interface Net {
  fetch(url: string, init: { range?: string; ifRange?: string; signal?: AbortSignal }): Promise<NetResponse>;   // rejects on a network failure (TypeError) or an abort (AbortError); follows redirects; sends cookies
}
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;  // rejects with an AbortError when the signal aborts
  every(ms: number, fn: () => void): () => void;           // returns the cancel function
}
export interface TransferHooks {
  persist(record: DlRecord): Promise<void>;                // a checkpoint: the bytes are flushed, store the record
  update(record: DlRecord): void;                          // in-memory progress, for the list
  bytes(n: number): void;                                  // bytes received, for the speed meter
}
export type TransferResult =
  | { kind: 'done'; record: DlRecord }                     // every byte is in the file, handle closed
  | { kind: 'paused'; record: DlRecord }                   // the signal aborted
  | { kind: 'failed'; record: DlRecord; error: string };   // record.error equals error
export interface Transfer {
  run(record: DlRecord, signal: AbortSignal, hooks: TransferHooks): Promise<TransferResult>;
  config(settings: DownloadSettings): void;
}
