import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';
import { nextWake, schedulePlan } from '@apps-hub/sieve-core/src/dl-queue.ts';

export const ALARM_SCHEDULE = 'dl-schedule';
export const ALARM_WATCHDOG = 'dl-watchdog';

// Work the engine must be alive for: bytes arriving, a save in flight, or a record the schedule says to start now.
export function runnable(records: readonly DlRecord[], settings: DownloadSettings, at: Date): boolean {
  return records.some((r) => r.state === 'saving' || r.state === 'running') || schedulePlan(records, settings.queues, at, settings.on).start.length > 0;
}

// Re-creating an alarm of the same name replaces it, so this is safe to call often.
export async function syncAlarms(records: readonly DlRecord[], settings: DownloadSettings, at: Date): Promise<void> {
  if (runnable(records, settings, at)) await chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  else await chrome.alarms.clear(ALARM_WATCHDOG);
  // A running record in a scheduled queue needs the alarm too: its window's close must stop it.
  const wake = nextWake(settings.queues, at);
  if (wake !== null && records.some((r) => !r.force && (r.state === 'queued' || r.state === 'running'))) {
    await chrome.alarms.create(ALARM_SCHEDULE, { when: Math.max(wake, at.getTime() + 1000) });
  } else await chrome.alarms.clear(ALARM_SCHEDULE);
}
