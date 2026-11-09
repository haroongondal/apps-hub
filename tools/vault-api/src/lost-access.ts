import { randomBytes } from 'strongroom-core/src/crypto.ts';
import { fromBase64, toBase64, tokenHash } from 'strongroom-core/src/format.ts';
import { BASE64_32_BYTES } from './auth.ts';
import { cancelLostRequestByToken, confirmLostRequest, getEscrow, getLostRequest, setLostRequest, type Db } from './db.ts';

export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const link = (publicUrl: string | undefined, path: string, token: Uint8Array) => `${publicUrl ?? ''}${path}?t=${encodeURIComponent(toBase64(token))}`;

// Mails and DB writes both silently no-op on any failure or missing escrow: this endpoint never reveals which happened.
export async function requestLostAccess(db: Db, claimHash: string, now: number, mail: Mailer | undefined, publicUrl: string | undefined): Promise<void> {
  if (!BASE64_32_BYTES.test(claimHash)) return;
  const escrow = await getEscrow(db);
  if (!escrow) return;
  const existing = await getLostRequest(db);
  if (existing && now - existing.requestedAt < HOUR_MS) return;
  const token = randomBytes(32);
  try {
    await mail!.send(escrow.email, 'Strongroom: confirm you lost access', `Open this link to start the 24-hour wait: ${link(publicUrl, '/v1/lost/confirm', token)}`);
  } catch {
    return;
  }
  await setLostRequest(db, claimHash, tokenHash(token), now);
}

export async function confirmLostAccess(db: Db, token: string, now: number, mail: Mailer | undefined, publicUrl: string | undefined): Promise<boolean> {
  if (!BASE64_32_BYTES.test(token)) return false;
  const ok = await confirmLostRequest(db, tokenHash(fromBase64(token)), now + DAY_MS);
  if (!ok) return false;
  try {
    const escrow = await getEscrow(db);
    if (escrow) await mail!.send(escrow.email, 'Strongroom: lost-access confirmed', `Wasn't you? Cancel it: ${link(publicUrl, '/v1/lost/cancel', fromBase64(token))}`);
  } catch {
    // The 24-hour wait already started; a failed notice doesn't undo that.
  }
  return true;
}

export async function cancelLostAccessByToken(db: Db, token: string): Promise<void> {
  if (!BASE64_32_BYTES.test(token)) return;
  await cancelLostRequestByToken(db, tokenHash(fromBase64(token)));
}

export async function lostAccessStatus(db: Db): Promise<{ escrow: boolean; pending: { releaseAt: number | null } | null }> {
  const escrow = await getEscrow(db);
  const req = await getLostRequest(db);
  return { escrow: escrow !== null, pending: req && !req.cancelled ? { releaseAt: req.releaseAt } : null };
}

export async function releaseLostAccess(db: Db, claim: string, now: number): Promise<{ state: 'ready'; blob: string } | { state: 'waiting'; releaseAt: number | null }> {
  if (BASE64_32_BYTES.test(claim)) {
    const req = await getLostRequest(db);
    if (req && !req.cancelled && req.claimHash === tokenHash(fromBase64(claim))) {
      if (req.releaseAt !== null && now >= req.releaseAt) {
        const escrow = await getEscrow(db);
        if (escrow) return { state: 'ready', blob: escrow.blob };
      }
      return { state: 'waiting', releaseAt: req.releaseAt };
    }
  }
  return { state: 'waiting', releaseAt: null };
}
