import type { StateChange } from '@apps-hub/sieve-core/src/dl-engine.ts';
import type { DoOp, SaveEvent } from '@apps-hub/sieve-core/src/dl-record.ts';

// Runtime message types of the engine (the `dl-eng-*` commands the worker sends, the `dl-sw-*` messages the engine sends).
export const ENG_MESSAGES = ['dl-eng-add', 'dl-eng-do', 'dl-eng-config', 'dl-eng-tick', 'dl-eng-save-event'] as const;
export const SW_MESSAGES = ['dl-sw-ready', 'dl-sw-save', 'dl-sw-idle'] as const;

export type WorkerCommand = 'config' | 'add' | 'do' | 'tick' | 'save-event';
// main thread to Worker; payload: DownloadSettings, AddItem[], { op: DoOp; ids: string[] }, undefined, SaveEvent
export interface WorkerRequest { id: number; cmd: WorkerCommand; payload: unknown }
export type { DoOp, SaveEvent };
export type WorkerMessage =                                                                  // Worker to main thread
  | { reply: number; result: unknown }                                                       // the answer to the request with that id; `{ error: string }` when the command threw
  | { push: 'state'; payload: StateChange }
  | { push: 'idle' }
  | { push: 'save'; req: number; payload: { id: string; name: string; path: string; size: number | null } };
export interface SaveReply { saveReply: number; result: { ok: true } | { ok: false; message: string } }   // main thread to Worker, the answer to a `save` push with that req
