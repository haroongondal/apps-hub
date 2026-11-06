import { equalBytes, kdfInRange, kdfWeaker } from '../crypto.ts';
import { openWithPassword } from '../format.ts';
import type { Header } from '../format.ts';

// A header from the server (a password changed on another device) is taken only if it is no weaker, keeps the account-key flag, and the owner's password opens it to the vault key this device already holds.
export async function adoptHeader(
  local: Header,
  remote: Header,
  password: string,
  accountKey: Uint8Array | undefined,
  vaultKey: Uint8Array,
): Promise<Header | 'refused'> {
  if (!kdfInRange(remote.kdf) || kdfWeaker(remote.kdf, local.kdf)) return 'refused';
  if ((local.accountKey || accountKey) && !remote.accountKey) return 'refused';
  const opened = await openWithPassword(remote, password, undefined, accountKey);
  return opened && equalBytes(opened.vaultKey, vaultKey) ? remote : 'refused';
}
