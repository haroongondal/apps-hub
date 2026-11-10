import type { DownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';

export async function readDownloads(): Promise<DownloadSettings> {
  throw new Error('not implemented');
}
export function saveDownloads(_edit: (s: DownloadSettings) => DownloadSettings): Promise<boolean> {
  throw new Error('not implemented');
}
export async function getDownloads(): Promise<DownloadSettings> {
  throw new Error('not implemented');
}
export function onDownloadsChanged(_cb: (s: DownloadSettings) => void): void {
  throw new Error('not implemented');
}
