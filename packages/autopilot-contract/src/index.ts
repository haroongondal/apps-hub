import neverShare from '../fixtures/never-share.json' with { type: 'json' };

export const AUTHORITY = 'com.haroon.inflow.autopilot';
export const PERMISSION = 'com.haroon.permission.AUTOPILOT';

export const KINDS = ['reply', 'bill', 'event', 'money'] as const;
export const STATES = ['waiting', 'started', 'done', 'skipped', 'expired'] as const;
export type Kind = (typeof KINDS)[number];
export type State = (typeof STATES)[number];

export interface SuggestionRow {
  id: number;
  kind: Kind;
  title: string;
  item_id: number;
  due_at: number | null;
  state: State;
  created_at: number;
  expires_at: number;
}

// Every key of SuggestionRow; the Record type makes tsc fail if one is added or dropped here.
const rowKeys: Record<keyof SuggestionRow, true> = {
  id: true, kind: true, title: true, item_id: true, due_at: true, state: true, created_at: true, expires_at: true,
};
export const ROW_KEYS = Object.keys(rowKeys) as (keyof SuggestionRow)[];

/** Packages whose items never reach the AI or Deputy. */
export const NEVER_SHARE: readonly string[] = neverShare;
