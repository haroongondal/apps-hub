import { fromBase64, toBase64 } from '../format.ts';
import { LIMITS } from './protocol.ts';
import type { AccountCreate, AccountUpdate, Prelogin, PullResponse, PushConflict, PushRequest, PushResponse } from './protocol.ts';

export class SyncHttpError extends Error {
  status: number;
  constructor(status: number, message = `The vault server answered with error ${status}. Try again later.`) {
    super(message);
    this.status = status;
  }
}

export class SyncAuthError extends SyncHttpError {
  constructor() {
    super(401, 'The vault server did not accept this sign-in. Sign in again with your master password and account key.');
  }
}

export class SyncOfflineError extends Error {
  constructor() {
    super('The vault server could not be reached. Check the connection and try again.');
  }
}

export class SyncRollbackError extends Error {
  constructor() {
    super('The vault server sent an older history than this device already has, so nothing was changed. Try again later.');
  }
}

export interface Transport {
  prelogin(): Promise<Prelogin | null>;
  pull(token: Uint8Array, since: number): Promise<PullResponse>;
  push(token: Uint8Array, req: PushRequest): Promise<PushResponse | PushConflict>;
  putAccount(auth: { setupToken: string }, body: AccountCreate): Promise<{ headerRev: number }>;
  putAccount(auth: Uint8Array, body: AccountUpdate): Promise<{ headerRev: number }>;
}

const TIMEOUT_MS = 30_000;

export function fetchTransport(baseUrl: string, fetchFn: typeof fetch = fetch): Transport {
  async function call(method: string, path: string, auth?: Uint8Array | string, body?: unknown): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = body === undefined ? {} : { 'content-type': 'application/json' };
    if (auth !== undefined) headers.authorization = `Bearer ${typeof auth === 'string' ? auth : toBase64(auth)}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let status: number;
    let text: string;
    try {
      const res = await fetchFn(new URL(path, baseUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
      status = res.status;
      text = await res.text();
    } catch {
      throw new SyncOfflineError();
    } finally {
      clearTimeout(timer);
    }
    if (status === 401) throw new SyncAuthError();
    try {
      return { status, data: JSON.parse(text) };
    } catch {
      throw new SyncHttpError(status, UNREADABLE);
    }
  }
  // The shape is checked here, so a wrong body is an error the caller can report, never a TypeError deep inside sync.
  const ok = ({ status, data }: { status: number; data: any }, shaped: (d: any) => boolean, expected = 200): any => {
    if (status !== expected) throw new SyncHttpError(status);
    if (!isObj(data) || !shaped(data)) throw new SyncHttpError(status, UNREADABLE);
    return data;
  };
  return {
    async prelogin() {
      const r = await call('GET', '/v1/prelogin');
      return r.status === 404 ? null : ok(r, (d) => isObj(d.kdf) && SALT.test(String(d.salt)) && typeof d.accountKey === 'boolean');
    },
    pull: async (token, since) =>
      ok(
        await call('GET', `/v1/records?since=${since}`, token),
        (d) => typeof d.header === 'string' && int(d.headerRev) && Array.isArray(d.records) && d.records.every(isObj) && int(d.latestRev) && typeof d.more === 'boolean',
      ),
    async push(token, req) {
      const r = await call('POST', '/v1/records', token, req);
      return r.status === 409
        ? ok(r, (d) => Array.isArray(d.conflicts), 409)
        : ok(r, (d) => Array.isArray(d.revs) && d.revs.every(isObj) && int(d.latestRev));
    },
    putAccount: async (auth: Uint8Array | { setupToken: string }, body: AccountCreate | AccountUpdate) =>
      ok(await call('PUT', '/v1/account', auth instanceof Uint8Array ? auth : auth.setupToken, body), (d) => int(d.headerRev)),
  };
}

const UNREADABLE = 'The vault server sent a reply this device could not read. Try again later.';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown) => Number.isSafeInteger(v);
const SALT = /^[A-Za-z0-9+/]{22}==$/; // base64 of the header's 16-byte salt

// sealed is null when the ciphertext is oversize or not base64: the row can't be read, but its id must not be uploaded over.
export type PulledRow = { id: string; rev: number; sealed: Uint8Array | null };
export type Pulled = { header: string; headerRev: number; rows: PulledRow[]; skipped: number; latestRev: number };

const ciphertextOf = (c: unknown): Uint8Array | null => {
  if (typeof c !== 'string' || c.length > LIMITS.maxCiphertextChars) return null;
  try {
    return fromBase64(c);
  } catch {
    return null;
  }
};

// Every page since `since`, newest row per id, nothing written: the caller applies it all in one write or not at all.
export async function pullAll(t: Transport, token: Uint8Array, since: number): Promise<Pulled> {
  const rows = new Map<string, PulledRow>();
  let skipped = 0;
  for (let from = since; ; ) {
    const page = await t.pull(token, from);
    if (!(page.latestRev >= since)) throw new SyncRollbackError();
    let next = from;
    for (const r of page.records) {
      const revOk = Number.isSafeInteger(r.rev) && r.rev > from;
      if (revOk) next = Math.max(next, r.rev);
      if (!revOk || typeof r.id !== 'string' || !LIMITS.idPattern.test(r.id)) skipped++;
      else if (!((rows.get(r.id)?.rev ?? 0) > r.rev)) rows.set(r.id, { id: r.id, rev: r.rev, sealed: ciphertextOf(r.ciphertext) });
    }
    if (!page.more) return { header: page.header, headerRev: page.headerRev, rows: [...rows.values()], skipped, latestRev: page.latestRev };
    if (next === from) throw new SyncRollbackError(); // "more" without moving forward would loop for ever
    from = next;
  }
}
