import type { Clock, Files, Net, Store, Transfer } from './dl-ports.ts';
import type { ProbeFacts } from './dl-takeover.ts';

export const CHECKPOINT_BYTES = 4_194_304; // persist a checkpoint after this many bytes
export const CHECKPOINT_MS = 2000; // or after this long, whichever comes first
export const PROBE_TIMEOUT_MS = 8000;

export interface TransferDeps {
  net: Net;
  files: Files;
  store: Store;
  clock: Clock;
}

export function createTransfer(_deps: TransferDeps): Transfer {
  throw new Error('not implemented');
}

// GET with `Range: bytes=0-0`; cancels the body; never throws: a failure is `factsFromError`.
export function probe(_net: Net, _url: string, _clock: Clock, _signal?: AbortSignal): Promise<ProbeFacts> {
  throw new Error('not implemented');
}
