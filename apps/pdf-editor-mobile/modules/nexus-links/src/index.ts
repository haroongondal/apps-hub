import { requireOptionalNativeModule } from 'expo-modules-core';

export type { AskIdRow, AskItemRow, DebitRow, PinnedRow, RunRow } from './shares.ts';

export type ReaderId = 'inflow.ask_items' | 'inflow.ask_ids' | 'inflow.debits' | 'deputy.runs' | 'clipboard.pinned';

/** `missing`: the app is not installed or has no such share yet. `refused`: its switch or guard said no. */
export type ReadStatus = 'ok' | 'missing' | 'refused' | 'failed';

export interface ReadResult {
  status: ReadStatus;
  rows: Record<string, unknown>[];
}

export interface LinkExtras {
  'com.haroon.inflow.action.ADD_TODO': { title: string; dueAt?: number; note?: string; source?: string };
  'com.haroon.deputy.action.PROPOSE_TASK': { task: string; context?: string; apps?: string[]; ref?: number };
}

export type LinkAction = keyof LinkExtras;

/** `unavailable`: no open screen, or the app is not installed. `failed` with code `bad_extras` started nothing. */
export type LinkStatus = 'done' | 'cancelled' | 'failed' | 'unavailable' | 'refused';

export interface LinkResult {
  status: LinkStatus;
  code?: string;
}

export type OpenableApp = 'store' | 'ai-hub';

export interface NexusLinksModule {
  readShare(id: ReaderId, sinceId?: number): Promise<ReadResult>;
  startLink<A extends LinkAction>(action: A, extras: LinkExtras[A]): Promise<LinkResult>;
  /** Opens the Store or AI hub. `unavailable`: not installed, or not signed like Nexus. */
  openApp(app: OpenableApp): Promise<LinkResult>;
}

export const NexusLinks = requireOptionalNativeModule<NexusLinksModule>('NexusLinks');
