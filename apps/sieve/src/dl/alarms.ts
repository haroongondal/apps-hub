import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';

export const ALARM_SCHEDULE = 'dl-schedule';
export const ALARM_WATCHDOG = 'dl-watchdog';

export function runnable(_records: readonly DlRecord[], _settings: DownloadSettings, _at: Date): boolean {
  throw new Error('not implemented');
}

export async function syncAlarms(_records: readonly DlRecord[], _settings: DownloadSettings, _at: Date): Promise<void> {
  throw new Error('not implemented');
}
