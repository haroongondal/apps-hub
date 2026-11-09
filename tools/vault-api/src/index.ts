import { LIMITS } from 'strongroom-core/src/sync/protocol.ts';
import type { AccountUpdate, Prelogin, Upsert } from 'strongroom-core/src/sync/protocol.ts';
import { authorize, BASE64_32_BYTES } from './auth.ts';
import { cancelLostRequest, clearEscrow, createAccount, getAccount, setEscrow, pull, push, updateAccount, type Db } from './db.ts';
import { cancelLostAccessByToken, confirmLostAccess, lostAccessStatus, releaseLostAccess, requestLostAccess, type Mailer } from './lost-access.ts';

export type { Db } from './db.ts';
export type { Mailer } from './lost-access.ts';
export interface Env { DB: Db; SETUP_TOKEN: string; MAIL?: Mailer; PUBLIC_URL?: string }
type Deps = { now?: () => number; sleep?: (ms: number) => Promise<void>; mail?: Mailer };

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status: number, error: string) => json({ error }, status);
const unauthorized = () => fail(401, 'The token was not accepted. Sign in again.');
const isBase64 = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
const html = (body: string, status = 200) =>
  new Response(`<!doctype html><title>Strongroom</title><p>${body}</p>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });

function escrowOf(o: any): { email: string; blob: string; code: string } | null | undefined {
  if (o?.escrow === undefined) return undefined;
  const { email, blob, code } = o.escrow ?? {};
  const emailOk = typeof email === 'string' && email.length > 0 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const codeOk = typeof code === 'string' && code.length > 0 && code.length <= 64;
  return emailOk && isBase64(blob) && codeOk ? { email, blob, code } : null;
}

export function preloginOf(header: string): Prelogin | null {
  try {
    const { version, kdf, salt, accountKey } = JSON.parse(header);
    const { memoryKiB, iterations, parallelism } = kdf;
    const ints = [version, memoryKiB, iterations, parallelism].every(Number.isInteger);
    if (!ints || typeof salt !== 'string' || (accountKey !== undefined && accountKey !== true)) return null;
    return { version, kdf: { memoryKiB, iterations, parallelism }, salt, accountKey: accountKey === true };
  } catch {
    return null;
  }
}

function accountPutOf(o: any): (Omit<AccountUpdate, 'ifRev'> & { ifRev?: number }) | null {
  const { header, loginHash, recoveryHash, readHash, ifRev } = o ?? {};
  if (typeof header !== 'string' || header.length > LIMITS.maxHeaderChars || !preloginOf(header)) return null;
  const hashes = recoveryHash === undefined ? [loginHash, readHash] : [loginHash, recoveryHash, readHash];
  if (!hashes.every((h) => typeof h === 'string' && BASE64_32_BYTES.test(h))) return null;
  if (ifRev !== undefined && !(Number.isSafeInteger(ifRev) && ifRev >= 0)) return null;
  return { header, loginHash, recoveryHash, readHash, ifRev };
}

function upsertsOf(o: any): Upsert[] | Response {
  const ups = o?.upserts;
  if (!Array.isArray(ups) || ups.length === 0) return fail(400, 'Send { upserts: [...] } with at least one record.');
  if (ups.length > LIMITS.maxUpserts) return fail(413, `Send at most ${LIMITS.maxUpserts} records per push.`);
  const seen = new Set<string>();
  for (const u of ups) {
    if (typeof u?.ciphertext === 'string' && u.ciphertext.length > LIMITS.maxCiphertextChars) return fail(413, 'A record is over 64 KiB. Shorten it.');
    const ok = typeof u?.id === 'string' && LIMITS.idPattern.test(u.id) && !seen.has(u.id) && Number.isSafeInteger(u.baseRev) && u.baseRev >= 0;
    if (!ok || !isBase64(u.ciphertext)) return fail(400, 'A record has a bad id, base revision or ciphertext.');
    seen.add(u.id);
  }
  return ups.map(({ id, baseRev, ciphertext }) => ({ id, baseRev, ciphertext }));
}

const intParam = (v: string | null, fallback: number) => (v === null ? fallback : /^\d{1,15}$/.test(v) ? Number(v) : NaN);

async function route(req: Request, env: Env, now: () => number, sleep: (ms: number) => Promise<void>, mail: Mailer | undefined): Promise<Response> {
  const url = new URL(req.url);
  const db = env.DB;

  if (req.method === 'GET' && url.pathname === '/v1/prelogin') {
    const account = await getAccount(db);
    const pre = account && preloginOf(account.header);
    return pre ? json(pre) : fail(404, 'No account has been set up yet.');
  }

  if (req.method === 'PUT' && url.pathname === '/v1/account') {
    const role = await authorize(req, db, env.SETUP_TOKEN, ['setup', 'login', 'recovery'], sleep);
    if (!role) return unauthorized();
    const raw = await req.json().catch(() => null);
    const body = accountPutOf(raw);
    if (!body || (role === 'setup' && body.recoveryHash === undefined)) return fail(400, 'The account needs a valid header and three token hashes.');
    const escrow = escrowOf(raw);
    if (escrow === null) return fail(400, 'Escrow needs an email, a blob and a code.');
    if (escrow && body.recoveryHash === undefined) return fail(400, 'Enrolling escrow needs a new recoveryHash.');
    if (escrow) {
      try {
        await mail!.send(escrow.email, 'Your Strongroom recovery code', `Your recovery code is ${escrow.code}. Keep it safe; Strongroom never stores it.`);
      } catch {
        return fail(502, 'Could not send the recovery email. Try again later.');
      }
    }
    if (role === 'setup') {
      const created = await createAccount(db, { ...body, recoveryHash: body.recoveryHash! });
      if (!created) return fail(403, 'The account already exists. Sign in instead.');
      if (escrow) await setEscrow(db, escrow.email, escrow.blob, now());
      return json({ headerRev: 1 });
    }
    if (body.ifRev === undefined) return fail(400, 'Send ifRev, the header revision this change is based on.');
    const stored = body.recoveryHash !== undefined && !escrow ? await getAccount(db) : null;
    const headerRev = await updateAccount(db, body, body.ifRev);
    if (headerRev === null) return fail(409, 'The account changed on another device. Pull and try again.');
    if (escrow) await setEscrow(db, escrow.email, escrow.blob, now());
    else if (stored && stored.recoveryHash !== body.recoveryHash) await clearEscrow(db);
    return json({ headerRev });
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/escrow') {
    if (!(await authorize(req, db, env.SETUP_TOKEN, ['login'], sleep))) return unauthorized();
    await clearEscrow(db);
    return json({ ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/v1/lost/request') {
    const raw = await req.json().catch(() => null);
    await requestLostAccess(db, typeof raw?.claimHash === 'string' ? raw.claimHash : '', now(), mail, env.PUBLIC_URL);
    return json({ ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/v1/lost/confirm') {
    const ok = await confirmLostAccess(db, url.searchParams.get('t') ?? '', now(), mail, env.PUBLIC_URL);
    return html(ok ? 'Confirmed. Strongroom will let you in after 24 hours.' : 'This link is no longer valid.');
  }

  if (req.method === 'GET' && url.pathname === '/v1/lost/cancel') {
    await cancelLostAccessByToken(db, url.searchParams.get('t') ?? '');
    return html('Cancelled. If a lost-access request was pending, it has stopped.');
  }

  if (req.method === 'POST' && url.pathname === '/v1/lost/cancel') {
    if (!(await authorize(req, db, env.SETUP_TOKEN, ['login', 'recovery', 'read'], sleep))) return unauthorized();
    await cancelLostRequest(db);
    return json({ ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/v1/lost/status') {
    if (!(await authorize(req, db, env.SETUP_TOKEN, ['login', 'recovery', 'read'], sleep))) return unauthorized();
    return json(await lostAccessStatus(db));
  }

  if (req.method === 'POST' && url.pathname === '/v1/lost/release') {
    const raw = await req.json().catch(() => null);
    return json(await releaseLostAccess(db, typeof raw?.claim === 'string' ? raw.claim : '', now()));
  }

  if (req.method === 'GET' && url.pathname === '/v1/records') {
    if (!(await authorize(req, db, env.SETUP_TOKEN, ['login', 'recovery', 'read'], sleep))) return unauthorized();
    const since = intParam(url.searchParams.get('since'), 0);
    const limit = intParam(url.searchParams.get('limit'), LIMITS.maxPullLimit);
    if (!(since >= 0 && limit >= 1 && limit <= LIMITS.maxPullLimit)) return fail(400, `since must be 0 or more and limit 1 to ${LIMITS.maxPullLimit}.`);
    const page = await pull(db, since, limit);
    return page ? json(page) : unauthorized();
  }

  if (req.method === 'POST' && url.pathname === '/v1/records') {
    if (!(await authorize(req, db, env.SETUP_TOKEN, ['login', 'recovery'], sleep))) return unauthorized();
    const ups = upsertsOf(await req.json().catch(() => null));
    if (ups instanceof Response) return ups;
    const result = await push(db, ups, now());
    return 'conflicts' in result ? json(result, 409) : json(result);
  }

  return fail(404, 'Not found.');
}

export async function handle(req: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  try {
    return await route(req, env, deps.now ?? Date.now, sleep, deps.mail ?? env.MAIL);
  } catch {
    return fail(500, 'The vault server failed. Try again later.');
  }
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
