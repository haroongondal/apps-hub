import type { AddItem, DlRecord, DoOp, SaveEvent } from './dl-record.ts';
import type { Clock, Files, Store, Transfer } from './dl-ports.ts';
import type { DownloadSettings } from './dl-settings.ts';

export const IDLE_MS = 60_000; // nothing to do for this long: ask the worker to close the document
export const EMIT_MS = 250; // at most four state broadcasts a second

export interface StateChange {
  records: DlRecord[];
  removed: string[];
  speeds: Record<string, number>;
  total: number;
}

export interface Host {
  emit(change: StateChange): void;
  save(r: DlRecord): Promise<{ ok: true } | { ok: false; message: string }>; // hand the finished private copy to the worker (Task 3.12); ok means "Chrome has been asked"
  idle(): void;
}

export interface EngineDeps {
  store: Store;
  files: Files;
  transfer: Transfer;
  clock: Clock;
  host: Host;
  random(): number;
}

export interface Engine {
  start(settings: DownloadSettings): Promise<void>;
  config(settings: DownloadSettings): void;
  add(items: AddItem[]): Promise<{ ids: string[] }>; // resolves after every new record is persisted
  act(op: DoOp, ids: string[]): Promise<void>;
  saveEvent(e: SaveEvent): Promise<void>;
  tick(): void; // re-evaluate queue windows now
  stop(): Promise<void>; // abort transfers without changing any record (for tests and shutdown)
  records(): DlRecord[];
}

export function createEngine(_deps: EngineDeps): Engine {
  throw new Error('not implemented');
}
