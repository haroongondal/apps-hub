import { appHealthShare, defineShare } from '@apps-hub/app-link-contract';

export const HEALTH_SHARE = appHealthShare('deputy');

export interface WaitingRow {
  id: number;
  /** A name the owner gave (saved or repeating task) or a fixed phrase; never screen text or someone else's words. */
  label: string;
  due_at: number | null;
  state: string;
}

export const WAITING_SHARE = defineShare<WaitingRow>()({
  authority: 'com.haroon.deputy.applink',
  path: 'waiting',
  columns: { id: 'long', label: 'string', due_at: 'long?', state: 'string' },
  maxRows: 100,
  description: "What waits for the owner in Deputy (an OK, the next repeating tasks, drafts), for the morning briefing. Off until the owner turns on 'Share what is waiting with my other Haroon apps'.",
});

export interface RunRow {
  id: number;
  /** As the owner typed it: no screen contents, no steps, no shared text. */
  task: string;
  state: string;
  finished_at: number;
}

export const RUNS_SHARE = defineShare<RunRow>()({
  authority: 'com.haroon.deputy.applink',
  path: 'runs',
  columns: { id: 'long', task: 'string', state: 'string', finished_at: 'long' },
  description: "Finished runs whose task the owner typed, read by Nexus only. Off until the owner turns on 'Let Nexus read my run history'.",
});
