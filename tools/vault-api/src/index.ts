import { LIMITS } from 'strongroom-core/src/sync/protocol.ts';
import type { AccountPut, Prelogin, Upsert } from 'strongroom-core/src/sync/protocol.ts';
import { authorize, BASE64_32_BYTES } from './auth.ts';
import { createAccount, getAccount, pull, push, updateAccount, type Db } from './db.ts';

export type { Db } from './db.ts';
export interface Env { DB: Db; SETUP_TOKEN: string }
type Deps = { now?: () => number; sleep?: (ms: number) => Promise<void> };

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'private, no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status: number, error: string) => json({ error }, status);
const unauthorized = () => fail(401, 'The token was not accepted. Sign in again.');
const isBase64 = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);

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

function accountPutOf(o: any): AccountPut | null {
  const { header, loginHash, recoveryHash, readHash, ifRev } = o ?? {};
  if (typeof header !== 'string' || header.length > LIMITS.maxHeaderChars || !preloginOf(header)) return null;
  if (![loginHash, recoveryHash, readHash].every((h) => typeof h === 'string' && BASE64_32_BYTES.test(h))) return null;
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

async function route(req: Request, env: Env, now: () => number, sleep: (ms: number) => Promise<void>): Promise<Response> {
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
    const body = accountPutOf(await req.json().catch(() => null));
    if (!body) return fail(400, 'The account needs a valid header and three token hashes.');
    if (role === 'setup') {
      return (await createAccount(db, body)) ? json({ headerRev: 1 }) : fail(403, 'The account already exists. Sign in instead.');
    }
    if (body.ifRev === undefined) return fail(400, 'Send ifRev, the header revision this change is based on.');
    const headerRev = await updateAccount(db, body, body.ifRev);
    return headerRev === null ? fail(409, 'The account changed on another device. Pull and try again.') : json({ headerRev });
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
    return await route(req, env, deps.now ?? Date.now, sleep);
  } catch {
    return fail(500, 'The vault server failed. Try again later.');
  }
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
