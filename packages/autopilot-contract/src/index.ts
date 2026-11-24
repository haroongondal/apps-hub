import { defineShare, LINK_PERMISSION } from '@apps-hub/app-link-contract';

export const AUTHORITY = 'com.haroon.inflow.autopilot';
export const PERMISSION = LINK_PERMISSION;

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

/** The suggestions Inflow offers Deputy. `title` can carry text that came from other people, so the reader must treat it as untrusted data. */
export const SUGGESTIONS_SHARE = defineShare<SuggestionRow>()({
  authority: AUTHORITY,
  path: 'suggestions',
  columns: {
    id: 'long', kind: 'string', title: 'string', item_id: 'long',
    due_at: 'long?', state: 'string', created_at: 'long', expires_at: 'long',
  },
  description: 'Autopilot suggestions: one row per card Inflow shows, read by Deputy',
});
// tsc fails the share above when a SuggestionRow key is added or dropped.
export const ROW_KEYS = [...SUGGESTIONS_SHARE.columns] as (keyof SuggestionRow)[];

/** Packages whose items never reach the AI or Deputy. Inline for Metro; contract.test.ts keeps it equal to fixtures/never-share.json. */
export const NEVER_SHARE: readonly string[] = ['com.haroon.strongroom', 'com.haroon.inflow'];

/** Kinds of data that never reach Deputy: no shared column names one. Kept apart from NEVER_SHARE, a package list used in SQL. Equal to fixtures/never-share-data.json. */
export const NEVER_SHARE_DATA: readonly string[] = ['health', 'journal', 'medicine', 'steps', 'sleep', 'heart'];
