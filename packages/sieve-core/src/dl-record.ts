// The download record, its state machine and the stored error sentences. Pure.
import type { CategoryId } from './dl-settings.ts';

export type DlState = 'queued' | 'running' | 'paused' | 'saving' | 'done' | 'failed';
export type DlEvent = 'start' | 'pause' | 'resume' | 'stop' | 'partsDone' | 'fail' | 'saved' | 'saveFailed' | 'restart';
export type DlSource = 'takeover' | 'manual' | 'menu';
export interface PartRecord { start: number; end: number | null; done: number }   // bytes start..end inclusive; `done` bytes written from `start`; end null = unknown length
export interface DlRecord {
  id: string;                    // newId()
  url: string;                   // what Chrome or the owner gave
  finalUrl: string;              // after redirects; equals url until the probe says otherwise
  referrer: string;              // '' or an absolute URL
  name: string;                  // sanitised file name with extension
  category: CategoryId;
  categoryFixed: boolean;        // true when the owner chose it; the probe then keeps it
  queue: string;                 // a QueueSetting id
  state: DlState;
  force: boolean;                // the owner pressed Resume: run now, whatever the window and the slot limit
  size: number | null;           // bytes; null until known
  rangeOk: boolean;              // the server answered 206 to a Range request
  validator: string | null;      // strong ETag or Last-Modified, sent back as If-Range
  mime: string;                  // lowercase, no parameters, '' unknown
  parts: PartRecord[];           // empty until planned
  partsWanted: number;           // DownloadSettings.parts when the record was added
  addedAt: number; startedAt: number | null; finishedAt: number | null;   // epoch ms
  error: string | null;          // a sentence from ERRORS when state is 'failed'
  saveOnly: boolean;             // every byte is in the private copy; only the save to Downloads is left
  savedPath: string | null;      // absolute path Chrome saved to
  savedId: number | null;        // Chrome's download id of the save
  chromeId: number | null;       // Chrome's own download that Sieve took over (history only)
  source: DlSource;
}
export interface NewRecord { url: string; referrer: string; name: string; category: CategoryId; categoryFixed: boolean; queue: string; source: DlSource; partsWanted: number; finalUrl?: string; size?: number | null; mime?: string; validator?: string | null; rangeOk?: boolean; chromeId?: number | null }
export type DoOp = 'pause' | 'resume' | 'remove';
export interface AddItem {                                  // what a page, a menu or the take-over asks the engine to add
  url: string; referrer?: string; name?: string; category?: CategoryId; queue?: string; source: DlSource; chromeId?: number;
  probed?: { finalUrl: string; size: number; mime: string; validator: string | null; name: string };   // set by the take-over: the probe already ran
}
export type SaveEvent =
  | { id: string; kind: 'path'; filename: string; chromeId: number }
  | { id: string; kind: 'done'; filename: string; chromeId: number }
  | { id: string; kind: 'failed'; error: string };

/** 'd' + now in base 36 + 8 base-36 digits of random() (4 digits collide about 1 time in 4 when 1000 ids are made in one millisecond). */
export function newId(_now: number, _random: () => number): string {
  throw new Error('not implemented');
}
export function newRecord(_init: NewRecord, _now: number, _id: string): DlRecord {
  throw new Error('not implemented');
}
/** null = illegal. */
export function nextState(_state: DlState, _event: DlEvent): DlState | null {
  throw new Error('not implemented');
}
/** An illegal event returns r itself. */
export function applyEvent(_r: DlRecord, _event: DlEvent, _now: number, _payload?: { error?: string }): DlRecord {
  throw new Error('not implemented');
}
export const partName = (id: string): string => `${id}.part`;               // the OPFS file of a record
/** Sum of the parts' done. */
export function bytesDone(_r: DlRecord): number {
  throw new Error('not implemented');
}
/** Size 0, or size known, parts planned and every part's done equals its length. */
export function isComplete(_r: DlRecord): boolean {
  throw new Error('not implemented');
}

export const ERRORS = {
  network: "The connection dropped and Sieve couldn't reconnect. Check your network, then press Resume.",
  refused: 'The server keeps refusing requests. Wait a few minutes, then press Resume.',
  changed: 'The file changed on the server while Sieve was downloading it. Press Retry in Chrome to download it again.',
  length: 'The server sent a different amount of data than it announced. Press Resume to try again.',
  space: "There isn't enough space on this computer for this file. Free some space, then press Resume.",
  storage: "Sieve couldn't write the file to its private storage. Free some space, then press Resume.",
  saveCanceled: 'The save was canceled in Chrome. Press Resume to save the file again.',
  unknown: 'The download stopped for an unknown reason. Press Resume to try again.',
  probe: "Sieve couldn't read this link. Press Retry in Chrome to let Chrome download it.",
  status: (code: number): string => `The server answered ${code}. The link may have expired. Press Retry in Chrome, or open the page the link came from.`,
  /** Maps the code to a fixed sentence and never repeats raw text. */
  save: (code: string): string =>
    code === 'FILE_NO_SPACE' ? ERRORS.space
    : code === 'USER_CANCELED' ? ERRORS.saveCanceled
    : "Chrome couldn't save the finished file. Press Resume to save it again.",
};
