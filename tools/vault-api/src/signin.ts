import { randomBytes } from 'strongroom-core/src/crypto.ts';
import { fromBase64, tokenHash } from 'strongroom-core/src/format.ts';
import { BASE64_32_BYTES } from './auth.ts';
import { approveSigninRequest, claimSigninRequest, denySigninRequestByToken, getEscrow, getSigninBlob, getSigninRequest, type Db } from './db.ts';
import { claimBytesOf, link, type Mailer } from './lost-access.ts';

const HOUR_MS = 60 * 60 * 1000;
const RELEASE_GRACE_MS = HOUR_MS;
const LIVE_CAP = 5;

// Throws on a value that isn't 0 or more hours, so a typo like "24h" fails loudly instead of silently turning the wait off.
export function signinWaitMs(hours: string | number | undefined): number {
  const ms = Math.round(Number(hours ?? 0) * HOUR_MS);
  if (!(ms >= 0 && Number.isSafeInteger(ms))) throw new Error('SIGNIN_WAIT_HOURS must be a number of hours, 0 or more.');
  return ms;
}

// No dots, colons, slashes or @, so a device-chosen name can't become a link in the owner's mail.
export function deviceLabel(name: unknown): string {
  const clean = typeof name === 'string' ? name.slice(0, 240).replace(/[^\p{L}\p{M}\p{N} _()'-]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';
  return Array.from(clean).slice(0, 60).join('').trim() || 'Unnamed device';
}

export async function requestSignin(db: Db, claimHash: string, deviceName: unknown, now: number, waitMs: number, mail: Mailer | undefined, publicUrl: string | undefined): Promise<void> {
  if (!BASE64_32_BYTES.test(claimHash) || (await getSigninBlob(db)) === null) return;
  const escrow = await getEscrow(db);
  if (!escrow) return;
  const approve = randomBytes(32);
  const deny = randomBytes(32);
  if (!(await claimSigninRequest(db, { claim: claimHash, approve: tokenHash(approve), deny: tokenHash(deny) }, now, HOUR_MS, waitMs + RELEASE_GRACE_MS, LIVE_CAP))) return;
  const text = [
    'A device asked to sign in to your Strongroom vault with your email code.',
    '',
    `Device (the name it gave itself): ${deviceLabel(deviceName)}`,
    `Time: ${new Date(now).toUTCString()}`,
    '',
    `If this was you, approve it: ${link(publicUrl, '/v1/signin/approve', approve)}`,
    ...(waitMs > 0 ? [`After you approve, it can sign in ${waitMs / HOUR_MS} hours later. You can deny it until then.`] : []),
    `Wasn't you? Deny it: ${link(publicUrl, '/v1/signin/deny', deny)}`,
  ].join('\n');
  try {
    await mail!.send(escrow.email, 'Strongroom: a device wants to sign in', text);
  } catch {
    return;
  }
}

export async function approveSignin(db: Db, token: string, now: number): Promise<'approved' | 'already' | 'invalid'> {
  if (!BASE64_32_BYTES.test(token)) return 'invalid';
  return approveSigninRequest(db, tokenHash(fromBase64(token)), now, HOUR_MS);
}

export async function denySignin(db: Db, token: string): Promise<void> {
  if (BASE64_32_BYTES.test(token)) await denySigninRequestByToken(db, tokenHash(fromBase64(token)));
}

export async function releaseSignin(db: Db, claim: string, now: number, waitMs: number): Promise<{ state: 'ready'; blob: string } | { state: 'waiting'; releaseAt: number | null }> {
  const claimBytes = claimBytesOf(claim);
  if (claimBytes) {
    const req = await getSigninRequest(db, tokenHash(claimBytes));
    const releaseAt = req && !req.cancelled && req.approvedAt !== null ? req.approvedAt + waitMs : null;
    // Past its grace hour an approved request is spent, and looks like no request.
    if (req && !req.cancelled && (releaseAt === null || now < releaseAt + RELEASE_GRACE_MS)) {
      if (releaseAt !== null && now >= releaseAt) {
        const blob = await getSigninBlob(db);
        if (blob !== null) return { state: 'ready', blob };
      }
      return { state: 'waiting', releaseAt };
    }
  }
  return { state: 'waiting', releaseAt: null };
}
