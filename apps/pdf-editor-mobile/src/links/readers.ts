import type { PagedSource, SnapshotSource, SourceProvider, SourceStatus } from '@apps-hub/knowledge-core';
import type { SourceApp } from '@apps-hub/library-core';
import type { DebitRow, LinkAction, LinkExtras, LinkResult, LinkStatus, NexusLinksModule, ReaderId, ReadResult, ReadStatus } from 'nexus-links';

export type { DebitRow, LinkAction, LinkExtras, LinkResult, LinkStatus };

export type Native = Pick<NexusLinksModule, 'readShare' | 'startLink'> | null;

const READ_STATUSES: readonly string[] = ['ok', 'missing', 'refused', 'failed'];
const LINK_STATUSES: readonly string[] = ['done', 'cancelled', 'failed', 'unavailable', 'refused'];
const CODE = /^[a-z0-9_]{1,40}$/;
const FAILED: ReadResult = { status: 'failed', rows: [] };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isSafe = (x: unknown): x is number => Number.isSafeInteger(x);

export async function readShare(native: Native, id: ReaderId, sinceId?: number): Promise<ReadResult> {
  if (!native) return { status: 'missing', rows: [] };
  try {
    const r: unknown = sinceId === undefined ? await native.readShare(id) : await native.readShare(id, sinceId);
    if (!isObject(r) || typeof r.status !== 'string' || !READ_STATUSES.includes(r.status)) return FAILED;
    if (r.status !== 'ok') return { status: r.status as ReadStatus, rows: [] };
    return Array.isArray(r.rows) ? { status: 'ok', rows: r.rows.filter(isObject) } : FAILED;
  } catch {
    return FAILED;
  }
}

// A failed read still says 'ready', so the sync runs, gets null from the reader and reports a failure instead of "Off in <app>".
export const sourceStatus = (s: ReadStatus): SourceStatus => (s === 'missing' ? 'missing' : s === 'refused' ? 'off' : 'ready');

export function inflowSource(native: Native): PagedSource {
  return {
    status: async () => sourceStatus((await readShare(native, 'inflow.ask_ids', 0)).status),
    async items(sinceId, limit) {
      const r = await readShare(native, 'inflow.ask_items', sinceId);
      if (r.status !== 'ok') return null;
      return r.rows.slice(0, Math.max(0, limit)).map((row) => ({ id: row.id, text: row.text, at: row.at, from: typeof row.sender === 'string' ? row.sender : null }));
    },
    async liveIds(sinceId) {
      const r = await readShare(native, 'inflow.ask_ids', sinceId);
      return r.status === 'ok' ? r.rows.map((row) => row.id) : null;
    },
  };
}

function snapshotSource(native: Native, id: ReaderId, toRow: (row: Record<string, unknown>) => unknown): SnapshotSource {
  return {
    status: async () => sourceStatus((await readShare(native, id)).status),
    async snapshot() {
      const r = await readShare(native, id);
      return r.status === 'ok' ? r.rows.map(toRow) : null;
    },
  };
}

const RUN_ENDS: Record<string, string> = {
  done: 'Deputy finished it.',
  failed: 'Deputy could not finish it.',
  stopped: 'It was stopped before the end.',
  declined: 'You said no to a step, so it ended.',
  capped: 'It reached its spending limit.',
  interrupted: 'It was interrupted.',
};

export function runText(task: unknown, state: unknown): string | null {
  if (typeof task !== 'string') return null;
  return `${task}\n${typeof state === 'string' && Object.hasOwn(RUN_ENDS, state) ? RUN_ENDS[state] : 'It ended.'}`;
}

export const deputySource = (native: Native): SnapshotSource =>
  snapshotSource(native, 'deputy.runs', (row) => ({ id: row.id, text: runText(row.task, row.state), at: row.finished_at, from: null }));

export const clipboardSource = (native: Native): SnapshotSource =>
  snapshotSource(native, 'clipboard.pinned', (row) => ({ id: row.id, text: row.text, at: row.pinned_at, from: row.from_app }));

export const sourceProviders = (native: Native): Record<SourceApp, SourceProvider> => ({
  inflow: inflowSource(native),
  deputy: deputySource(native),
  clipboard: clipboardSource(native),
});

export function isDebit(row: Record<string, unknown>): row is Record<string, unknown> & DebitRow {
  return isSafe(row.id) && row.id > 0 && isSafe(row.amount_minor) && isSafe(row.at) && row.at >= 0 && typeof row.merchant === 'string' && typeof row.account === 'string';
}

export interface DebitsRead {
  status: SourceStatus | 'failed';
  rows: DebitRow[];
}

export async function readDebits(native: Native, sinceId = 0): Promise<DebitsRead> {
  const r = await readShare(native, 'inflow.debits', sinceId);
  if (r.status === 'failed') return { status: 'failed', rows: [] };
  return {
    status: sourceStatus(r.status),
    rows: r.rows.filter(isDebit).map(({ id, amount_minor, at, merchant, account }) => ({ id, amount_minor, at, merchant, account })),
  };
}

// Kotlin refuses a null for a typed extra (bad_extras), so extras left undefined or null are dropped before the bridge.
export async function startLink<A extends LinkAction>(native: Native, action: A, extras: LinkExtras[A]): Promise<LinkResult> {
  if (!native) return { status: 'unavailable' };
  const clean = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined && v !== null)) as LinkExtras[A];
  try {
    const r: unknown = await native.startLink(action, clean);
    if (!isObject(r) || typeof r.status !== 'string' || !LINK_STATUSES.includes(r.status)) return { status: 'failed' };
    const status = r.status as LinkStatus;
    return typeof r.code === 'string' && CODE.test(r.code) ? { status, code: r.code } : { status };
  } catch {
    return { status: 'failed' };
  }
}
