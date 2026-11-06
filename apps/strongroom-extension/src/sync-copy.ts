import type { SyncStatus } from './service.ts';

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

export function syncLines(sync: SyncStatus, time: (at: number) => string): string[] {
  if (!sync.available) return ["Sync isn't available in this build."];
  const lines: string[] = [];
  if (sync.state === 'off') lines.push('Sync is off. Sign in with your Strongroom account to share logins with your phone.');
  else if (sync.state === 'needsSignIn') lines.push('Sign in again to keep syncing. What you changed on this computer is kept and sent once you do.');
  else if (sync.state === 'syncing') lines.push('Syncing…');
  else if (sync.state === 'error') lines.push(sync.error ?? 'Sync stopped. Try again.');
  else lines.push(sync.lastSyncAt ? `Synced at ${time(sync.lastSyncAt)}.` : 'Not synced yet.');
  if (sync.pendingUpdate && sync.state === 'needsSignIn') lines.push("The new master password you set on this computer wasn't sent, and signing in replaces it with the one the vault server has.");
  else if (sync.pendingUpdate) lines.push("Your new master password hasn't reached the vault server yet. Strongroom sends it as soon as it can connect, and sync waits until then.");
  if (sync.blocked > 0) lines.push(`${items(sync.blocked)} couldn't be synced and ${sync.blocked === 1 ? 'was left as it is' : 'were left as they are'}.`);
  if (sync.quarantined > 0) lines.push(`${items(sync.quarantined)} on the vault server couldn't be read here and ${sync.quarantined === 1 ? 'was' : 'were'} left untouched.`);
  return lines;
}
