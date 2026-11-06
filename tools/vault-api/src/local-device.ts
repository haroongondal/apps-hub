// Phone proof only (Task 6c): a second device made of strongroom-core, signed in to the local HTTPS server with the master password and account key.
import { fetchTransport, newId, parseAccountKey, readEntries, signInWithPassword, syncOnce, toBase64, writeEntries } from 'strongroom-core';
import { MemorySyncStore } from 'strongroom-core/src/__tests__/memory-sync-store.ts';

const USAGE = `usage: NODE_EXTRA_CA_CERTS=<dir>/cert.pem node --disable-warning=ExperimentalWarning tools/vault-api/src/local-device.ts \\
  <url> <master password> <account key> list | add <name> <username> <password> | tokens`;
const [url, password, accountKeyText, command, ...rest] = process.argv.slice(2);
const accountKey = parseAccountKey(accountKeyText ?? '');
if (!url || !password || !accountKey || !command) throw new Error(USAGE);

const t = fetchTransport(url);
const s = await signInWithPassword(t, password, accountKey);
const store = new MemorySyncStore();
await store.applyPull({ header: s.header, headerRev: s.headerRev, records: s.records, quarantine: s.quarantine, rebase: [], lastRev: s.lastRev });

if (command === 'list') {
  const { items, unreadable } = await readEntries(store, s.vaultKey);
  for (const { id, entry } of items) console.log(id, entry.type, 'name' in entry ? entry.name : '');
  console.log(`${items.length} entries, ${s.quarantine.length} quarantined, ${unreadable} unreadable, headerRev ${s.headerRev}, lastRev ${s.lastRev}`);
} else if (command === 'add' && rest.length === 3) {
  const [name, username, pw] = rest;
  await writeEntries(store, s.vaultKey, [{ id: newId(), entry: { type: 'login', name, username, password: pw, sites: [], apps: [], note: '', updatedAt: Date.now() } }]);
  console.log(await syncOnce({ store, transport: t, vaultKey: s.vaultKey, token: s.loginToken }));
} else if (command === 'tokens') {
  for (const [name, token] of [['readToken', s.readToken], ['loginToken', s.loginToken]] as const) {
    console.log(name, toBase64(token!), Buffer.from(token!).toString('hex'));
  }
} else {
  throw new Error(USAGE);
}
