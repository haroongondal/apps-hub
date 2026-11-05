import { KDF_FLOOR } from './crypto.ts';
import type { KdfParams } from './crypto.ts';
import type { Entry } from './entry.ts';
import { createVault, openEntry, sealEntry, unlockWithPassword, unlockWithRecovery, withNewPassword } from './format.ts';
import type { Header, Options } from './format.ts';
import { generateRecoveryKey, parseRecoveryKey } from './recovery-key.ts';

export type StoredRecord = { id: string; sealed: Uint8Array };

export interface RecordStore {
  getHeader(): Promise<Header | null>;
  getRecords(): Promise<StoredRecord[]>;
  commit(change: { header?: Header; records?: StoredRecord[] }): Promise<void>;
}

export const newId = (): string => crypto.randomUUID();

async function headerOf(store: RecordStore): Promise<Header> {
  const header = await store.getHeader();
  if (header === null) throw new Error('No vault is set up yet');
  return header;
}

export async function setupVault(store: RecordStore, password: string, opts?: Options): Promise<{ vaultKey: Uint8Array; recoveryKey: Uint8Array }> {
  if (await store.getHeader()) throw new Error('A vault already exists on this device');
  const recoveryKey = generateRecoveryKey();
  const { header, vaultKey } = await createVault(password, recoveryKey, opts);
  await store.commit({ header });
  return { vaultKey, recoveryKey };
}

// A vault whose header carries the account-key flag needs that key here too; without it unlock and recover throw AccountKeyRequired.
export async function unlock(store: RecordStore, password: string, floor: KdfParams = KDF_FLOOR, accountKey?: Uint8Array): Promise<Uint8Array | null> {
  return unlockWithPassword(await headerOf(store), password, floor, accountKey);
}

export async function recover(
  store: RecordStore,
  recoveryKeyText: string,
  newPassword: string,
  opts?: Options & { accountKey?: Uint8Array },
): Promise<Uint8Array | null> {
  const recoveryKey = parseRecoveryKey(recoveryKeyText);
  if (recoveryKey === null) return null;
  const header = await headerOf(store);
  const vaultKey = await unlockWithRecovery(header, recoveryKey);
  if (vaultKey === null) return null;
  await store.commit({ header: await withNewPassword(header, vaultKey, newPassword, opts) });
  return vaultKey;
}

// A record that won't decrypt is counted and left in the store, never dropped.
export async function readEntries(store: RecordStore, vaultKey: Uint8Array): Promise<{ items: { id: string; entry: Entry }[]; unreadable: number }> {
  const items: { id: string; entry: Entry }[] = [];
  let unreadable = 0;
  for (const { id, sealed } of await store.getRecords()) {
    const entry = await openEntry(vaultKey, id, sealed);
    if (entry) items.push({ id, entry });
    else unreadable++;
  }
  return { items, unreadable };
}

export async function writeEntries(store: RecordStore, vaultKey: Uint8Array, items: { id: string; entry: Entry }[]): Promise<void> {
  const records = await Promise.all(items.map(async ({ id, entry }) => ({ id, sealed: await sealEntry(vaultKey, id, entry) })));
  await store.commit({ records });
}
