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
export function newId(now: number, random: () => number): string {
  return 'd' + now.toString(36) + Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0');
}
export function newRecord(init: NewRecord, now: number, id: string): DlRecord {
  return {
    id, url: init.url, finalUrl: init.finalUrl ?? init.url, referrer: init.referrer, name: init.name,
    category: init.category, categoryFixed: init.categoryFixed, queue: init.queue,
    state: 'queued', force: false, size: init.size ?? null, rangeOk: init.rangeOk ?? false,
    validator: init.validator ?? null, mime: init.mime ?? '', parts: [], partsWanted: init.partsWanted,
    addedAt: now, startedAt: null, finishedAt: null, error: null, saveOnly: false,
    savedPath: null, savedId: null, chromeId: init.chromeId ?? null, source: init.source,
  };
}

const TRANSITIONS: Record<DlState, Partial<Record<DlEvent, DlState>>> = {
  queued: { start: 'running', pause: 'paused', fail: 'failed' },
  running: { pause: 'paused', stop: 'queued', partsDone: 'saving', fail: 'failed', restart: 'queued' },
  paused: { resume: 'queued' },
  saving: { saved: 'done', saveFailed: 'failed', restart: 'saving' },
  done: {},
  failed: { resume: 'queued' },
};
/** null = illegal. */
export function nextState(state: DlState, event: DlEvent): DlState | null {
  return TRANSITIONS[state][event] ?? null;
}
/** An illegal event returns r itself. */
export function applyEvent(r: DlRecord, event: DlEvent, now: number, payload?: { error?: string }): DlRecord {
  const state = nextState(r.state, event);
  if (!state) return r;
  const n = { ...r, state };
  switch (event) {
    case 'start': n.startedAt = r.startedAt ?? now; n.error = null; break;
    case 'pause': case 'stop': n.force = false; break;
    case 'resume':
      n.force = true; n.error = null;
      if (r.saveOnly || isComplete(r)) { n.state = 'saving'; n.saveOnly = true; }
      break;
    case 'partsDone': n.saveOnly = true; n.error = null; break;
    case 'fail': n.error = payload?.error ?? ERRORS.unknown; n.force = false; break;
    case 'saved': n.finishedAt = now; n.saveOnly = false; n.force = false; n.error = null; break;
    case 'saveFailed': n.error = payload?.error ?? ERRORS.unknown; n.saveOnly = true; n.force = false; break;
    case 'restart': break; // running goes back to queued with force kept; saving stays
  }
  return n;
}
export const partName = (id: string): string => `${id}.part`;               // the OPFS file of a record
/** Sum of the parts' done. */
export function bytesDone(r: DlRecord): number {
  return r.parts.reduce((sum, p) => sum + p.done, 0);
}
/** Size 0, or size known, parts planned and every part's done equals its length. */
export function isComplete(r: DlRecord): boolean {
  if (r.size === 0) return true;
  if (r.size === null || r.parts.length === 0) return false;
  return r.parts.every((p) => p.end !== null && p.done === p.end - p.start + 1);
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
