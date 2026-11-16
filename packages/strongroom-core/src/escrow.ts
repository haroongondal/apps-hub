import { hkdf, open, seal, utf8 } from './crypto.ts';
import { formatRecoveryKey, generateRecoveryKey, parseRecoveryKey } from './recovery-key.ts';

// The email code is the same 128-bit format as a recovery key, just shown to the user under a different name.
export const generateEmailCode = generateRecoveryKey;
export const formatEmailCode = formatRecoveryKey;
export const parseEmailCode = parseRecoveryKey;

const ESCROW_LABEL = 'strongroom/v1/escrow';
const ESCROW_AAD = utf8(ESCROW_LABEL);

export async function sealEscrow(code: Uint8Array, s: { recoveryKey: Uint8Array; accountKey: Uint8Array }): Promise<Uint8Array> {
  const plaintext = Uint8Array.from([...s.recoveryKey, ...s.accountKey]);
  return seal(hkdf(code, ESCROW_LABEL), plaintext, ESCROW_AAD);
}

export async function openEscrow(code: Uint8Array, blob: Uint8Array): Promise<{ recoveryKey: Uint8Array; accountKey: Uint8Array } | null> {
  const plain = await open(hkdf(code, ESCROW_LABEL), blob, ESCROW_AAD);
  if (!plain || plain.length !== 40) return null;
  return { recoveryKey: plain.slice(0, 20), accountKey: plain.slice(20, 40) };
}
