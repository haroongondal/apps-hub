import type { DlRecord } from './dl-record.ts';
import type { QueueSetting, Schedule } from './dl-settings.ts';

export interface Plan { start: string[]; stop: string[] }   // record ids

export function minutesOf(hhmm: string): number {   // '22:30' is 1350
  throw new Error('not implemented');
}
export function isOpen(s: Schedule, at: Date): boolean {
  throw new Error('not implemented');
}
// epoch ms of the next flip between open and closed; null when the schedule is off or never flips
export function nextChange(s: Schedule, at: Date): number | null {
  throw new Error('not implemented');
}
// the earliest nextChange over queues whose schedule is on
export function nextWake(queues: readonly QueueSetting[], at: Date): number | null {
  throw new Error('not implemented');
}
// the queue with that id, else the first
export function queueOf(queues: readonly QueueSetting[], id: string): QueueSetting {
  throw new Error('not implemented');
}
export function schedulePlan(records: readonly DlRecord[], queues: readonly QueueSetting[], at: Date, on: boolean): Plan {
  throw new Error('not implemented');
}
