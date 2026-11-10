// Test infrastructure, not a test file: a real Worker (tools/vault-api's `handle` over node:sqlite), the phone as a strongroom-core device and a fake chrome.storage.local.
// The service tests run it in-process; test/e2e.mjs serves the same Worker over plain HTTP, since the extension's fetch transport has no https-only rule.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  createVault, fetchTransport, formatAccountKey, formatRecoveryKey, generateRecoveryKey, headerToJson, KDF_FLOOR, newId, openWithPassword,
  randomBytes, readEntries, recoveryLoginToken, syncOnce, tokenHash, withNewPassword, writeEntries,
} from 'strongroom-core';
import type { Entry, Header } from 'strongroom-core';
import { MemorySyncStore } from 'strongroom-core/src/__tests__/memory-sync-store.ts';
import { handle } from '../../../../tools/vault-api/src/index.ts';
import { d1FromNodeSqlite } from '../../../../tools/vault-api/src/__tests__/d1-fake.ts';
import type { Mailer } from '../../../../tools/vault-api/src/lost-access.ts';

// Captures every mail the Worker would have sent, in order, so a test can read the emailed code or a confirm link without a real mailbox.
export function fakeMailer(): Mailer & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return { sent, send: async (to, subject, text) => void sent.push({ to, subject, text }) };
}

export const SETUP_TOKEN = 'setup-token-for-tests-0123456789abcdef';
export const PHONE_PASSWORD = 'first master password';
const migration = readFileSync(new URL('../../../../tools/vault-api/migrations/0001_init.sql', import.meta.url), 'utf8');
const migration2 = readFileSync(new URL('../../../../tools/vault-api/migrations/0002_escrow.sql', import.meta.url), 'utf8');

export const loginEntry = (name: string, updatedAt: number): Entry => ({ type: 'login', name, username: 'me', password: 'pw', sites: [], apps: [], note: '', updatedAt });

let made: ReturnType<typeof make> | undefined;
async function make() {
  const accountKey = randomBytes(20);
  const recoveryKey = generateRecoveryKey();
  const { header, vaultKey } = await createVault(PHONE_PASSWORD, recoveryKey, { kdf: KDF_FLOOR, accountKey });
  const keys = (await openWithPassword(header, PHONE_PASSWORD, undefined, accountKey))!;
  return { accountKey, recoveryKey, header, vaultKey, keys };
}

export type World = Awaited<ReturnType<typeof newWorld>>;

export async function newWorld() {
  const m = await (made ??= make());
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(migration2);
  const env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN };
  const mail = fakeMailer();
  const serve = (req: Request) => handle(req, env, { sleep: async () => {}, mail });

  const world = {
    sqlite, env, serve, mail,
    online: true,
    failPut: false,
    gate: undefined as undefined | Promise<void>,
    rewrite: undefined as undefined | ((path: string, body: any) => any),
    requests: [] as string[],
    accountKey: m.accountKey,
    accountKeyText: formatAccountKey(m.accountKey),
    recoveryKey: m.recoveryKey,
    recoveryKeyText: formatRecoveryKey(m.recoveryKey),
    password: PHONE_PASSWORD,
    tokens: m.keys,
    transport: undefined as unknown as ReturnType<typeof fetchTransport>,
    phone: undefined as unknown as Awaited<ReturnType<typeof makePhone>>,
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    world.requests.push(`${req.method} ${url.pathname}`);
    if (!world.online || (world.failPut && req.method === 'PUT')) throw new TypeError('offline');
    if (world.gate && req.method === 'PUT') await world.gate;
    const res = await serve(req);
    if (!world.rewrite) return res;
    return new Response(JSON.stringify(world.rewrite(url.pathname, await res.json())), { status: res.status, headers: res.headers });
  };
  world.transport = fetchTransport('https://vault.example', fetchFn);
  world.phone = await makePhone(world, m);
  world.requests.length = 0;
  return world;
}

async function makePhone(world: { serve: (r: Request) => Promise<Response> }, m: Awaited<ReturnType<typeof make>>) {
  const transport = fetchTransport('https://vault.example', (input, init) => world.serve(new Request(input, init)));
  const created = await transport.putAccount({ setupToken: SETUP_TOKEN }, {
    header: headerToJson(m.header), loginHash: tokenHash(m.keys.loginToken),
    recoveryHash: tokenHash(recoveryLoginToken(m.recoveryKey)), readHash: tokenHash(m.keys.readToken),
  });
  const store = new MemorySyncStore();
  await store.applyPull({ header: m.header, headerRev: created.headerRev, records: [], quarantine: [], rebase: [], lastRev: 0 });
  const phone = {
    store, transport, vaultKey: m.vaultKey, token: m.keys.loginToken, readHash: tokenHash(m.keys.readToken),
    async add(name: string, updatedAt = Date.now()) {
      const id = newId();
      await writeEntries(store, m.vaultKey, [{ id, entry: loginEntry(name, updatedAt) }]);
      return id;
    },
    edit: (id: string, entry: Entry) => writeEntries(store, m.vaultKey, [{ id, entry }]),
    sync: () => syncOnce({ store, transport, vaultKey: m.vaultKey, token: phone.token }),
    async names() {
      return (await readEntries(store, m.vaultKey)).items.flatMap(({ entry }) => (entry.type === 'login' ? [entry.name] : [])).sort();
    },
    async putHeader(header: Header, loginHash: string) {
      const { headerRev, lastRev } = await store.getSyncMeta();
      const put = await transport.putAccount(phone.token, { header: headerToJson(header), loginHash, readHash: phone.readHash, ifRev: headerRev });
      await store.applyPull({ header, headerRev: put.headerRev, records: [], quarantine: [], rebase: [], lastRev });
    },
    async changePassword(next: string) {
      const changed = await withNewPassword(store.header!, m.vaultKey, next, { accountKey: m.accountKey });
      const keys = (await openWithPassword(changed, next, undefined, m.accountKey))!;
      const { headerRev, lastRev } = await store.getSyncMeta();
      const put = await transport.putAccount(phone.token, { header: headerToJson(changed), loginHash: tokenHash(keys.loginToken), readHash: tokenHash(keys.readToken), ifRev: headerRev });
      await store.applyPull({ header: changed, headerRev: put.headerRev, records: [], quarantine: [], rebase: [], lastRev });
      phone.token = keys.loginToken;
      phone.readHash = tokenHash(keys.readToken);
    },
  };
  return phone;
}

export async function serveHttp(world: World): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const h of ['authorization', 'content-type']) if (req.headers[h]) headers.set(h, String(req.headers[h]));
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const response = await world.serve(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }));
    const body = Buffer.from(await response.arrayBuffer());
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.writeHead(response.status).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export function fakeChrome() {
  const data = new Map<string, unknown>();
  const setCalls: string[][] = [];
  const removeCalls: string[][] = [];
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const local = {
    async get(keys?: string | string[] | null) {
      const names = keys == null ? [...data.keys()] : typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(names.filter((k) => data.has(k)).map((k) => [k, clone(data.get(k))]));
    },
    async set(items: Record<string, unknown>) {
      setCalls.push(Object.keys(items));
      for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
    },
    async remove(keys: string | string[]) {
      const list = [keys].flat();
      removeCalls.push(list);
      for (const k of list) data.delete(k);
    },
    async setAccessLevel() {},
  };
  return { data, setCalls, removeCalls, chrome: { storage: { local } } };
}

export const useChrome = (f: ReturnType<typeof fakeChrome>) => void ((globalThis as any).chrome = f.chrome);
