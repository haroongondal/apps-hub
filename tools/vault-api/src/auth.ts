import { getAccount, type Db } from './db.ts';

export type Role = 'setup' | 'login' | 'recovery' | 'read';

export const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;
const enc = new TextEncoder();
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

// MACs both sides under a per-request random key, so timing never depends on the secret's bytes.
async function safeEqual(a: string, b: string, key: CryptoKey): Promise<boolean> {
  const mac = async (s: string) => b64(await crypto.subtle.sign('HMAC', key, enc.encode(s)));
  return (await mac(a)) === (await mac(b));
}

async function match(presented: string, db: Db, setupToken: string, allow: Role[]): Promise<Role | null> {
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  if (allow.includes('setup') && setupToken?.length >= 32 && (await safeEqual(presented, setupToken, key))) return 'setup';
  if (!BASE64_32_BYTES.test(presented)) return null;
  const account = await getAccount(db);
  if (!account) return null;
  const hash = b64(await crypto.subtle.digest('SHA-256', Uint8Array.from(atob(presented), (c) => c.charCodeAt(0))));
  let role: Role | null = null;
  for (const [r, stored] of [['login', account.loginHash], ['recovery', account.recoveryHash], ['read', account.readHash]] as const) {
    if ((await safeEqual(hash, stored, key)) && allow.includes(r)) role ??= r;
  }
  return role;
}

export async function authorize(req: Request, db: Db, setupToken: string, allow: Role[], sleep: (ms: number) => Promise<void>): Promise<Role | null> {
  const presented = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? '';
  const role = await match(presented, db, setupToken, allow);
  if (role) {
    await db.prepare('UPDATE auth_state SET failures = 0 WHERE id = 1 AND failures <> 0').all();
    return role;
  }
  const row = await db
    .prepare('INSERT INTO auth_state (id, failures) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET failures = COALESCE(failures, 0) + 1 RETURNING failures')
    .first<{ failures: number }>();
  const n = row?.failures ?? 0;
  if (n > 5) await sleep(Math.min(2 ** (n - 5), 30) * 1000);
  return null;
}
