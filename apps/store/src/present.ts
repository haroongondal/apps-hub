import type { StoreApp } from '@apps-hub/store-manifest';
import type { InstallStatusName } from 'store-installer';
import type { AppStatus, Installed } from './status.ts';

export type PillTone = 'neutral' | 'accent' | 'ok' | 'warn';

export function versionLines(app: StoreApp, installed: Installed | null): { label: string; version: string }[] {
  const release = app.android;
  const lines: { label: string; version: string }[] = [];
  if (installed) lines.push({ label: 'Installed', version: `${installed.versionName ?? '?'} (${installed.versionCode})` });
  if (release && (!installed || installed.versionCode < release.versionCode)) {
    lines.push({ label: 'Available', version: `${release.versionName} (${release.versionCode})` });
  }
  return lines;
}

export function statusPill(s: AppStatus): { label: string; tone: PillTone } {
  switch (s.kind) {
    case 'update':
      return { label: 'Update ready', tone: 'accent' };
    case 'installed':
      return s.warning && !s.action ? { label: 'Different key', tone: 'warn' } : { label: 'Installed', tone: 'ok' };
    case 'not-installed':
      return { label: 'Not installed', tone: 'neutral' };
    default:
      return { label: 'No Android build', tone: 'neutral' };
  }
}

const failures: Partial<Record<InstallStatusName, string>> = {
  FAILURE_CONFLICT: 'The installed copy is signed with a different key. Uninstall it once, then install it from Store.',
  FAILURE_STORAGE: 'This phone is out of storage. Free up some space, then try again.',
  FAILURE_INCOMPATIBLE: 'This build does not support this phone. Check the app’s minimum Android version.',
  FAILURE_BLOCKED: 'Android blocked the install. Check that Store may install unknown apps, then try again.',
  FAILURE_INVALID: 'The downloaded file did not pass Android’s checks. Pull down to refresh, then try again.',
  FAILURE_TIMEOUT: 'The install took too long. Try again.',
};

// FAILURE_ABORTED also covers Play Protect's ~17 s approval window expiring, not only the user tapping Cancel.
export function installFailure(status: InstallStatusName, message: string | null): string | null {
  if (status === 'SUCCESS' || status === 'PENDING_USER_ACTION' || status === 'DOWNLOADED' || status === 'INSTALLING') return null;
  if (status === 'FAILURE_DOWNLOAD') return `${message ?? 'The download stopped.'} Check your connection, then try again.`;
  if (status === 'FAILURE_ABORTED') {
    return 'The install was cancelled. If Google Play Protect asked to scan the app, tap Scan app (or approve within a few seconds), then try again.';
  }
  if (status === 'FAILURE_CONFLICT') return failures.FAILURE_CONFLICT!;
  const base = failures[status] ?? `Android stopped the install (${status}).`;
  return message ? `${base} Android said: ${message}` : base;
}

const mb = (bytes: number) => Math.round(bytes / 1e6);

export function downloadLabel(bytes: number, total: number): string {
  return total > 0 ? `Downloading ${mb(bytes)} of ${mb(total)} MB` : 'Downloading';
}

export function listSummary(statuses: AppStatus[]): string {
  if (statuses.length === 0) return 'No apps published yet';
  const updates = statuses.filter((s) => s.kind === 'update').length;
  if (updates > 0) return updates === 1 ? '1 update ready to install' : `${updates} updates ready to install`;
  const available = statuses.filter((s) => s.kind === 'not-installed').length;
  if (statuses.some((s) => s.kind === 'installed')) return 'Everything installed is up to date';
  if (available === 0) return 'No Android builds published yet';
  return available === 1 ? '1 app ready to install' : `${available} apps ready to install`;
}
