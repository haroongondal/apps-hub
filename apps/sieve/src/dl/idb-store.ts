import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { Store } from '@apps-hub/sieve-core/src/dl-ports.ts';

const DB_NAME = 'sieve-dl';
const RECORDS = 'records';
const META = 'meta';

const request = <T>(r: IDBRequest<T>): Promise<T> => new Promise((ok, fail) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => fail(r.error))));
const complete = (tx: IDBTransaction): Promise<void> =>
  new Promise((ok, fail) => {
    tx.oncomplete = () => ok();
    tx.onabort = () => fail(tx.error ?? new Error('transaction aborted'));
  });

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(RECORDS, { keyPath: 'id' });
      open.result.createObjectStore(META);
    };
    open.onerror = () => fail(open.error);
    open.onblocked = () => fail(new Error('sieve-dl is blocked'));
    open.onsuccess = () => {
      // A page or a test that deletes the database must not hang on this connection.
      open.result.onversionchange = () => open.result.close();
      ok(open.result);
    };
  });
}

export async function openStore(): Promise<Store> {
  const db = await openDb();
  return {
    async all() {
      const tx = db.transaction(RECORDS, 'readonly');
      return request<DlRecord[]>(tx.objectStore(RECORDS).getAll());
    },
    async put(record, options) {
      const tx = db.transaction(RECORDS, 'readwrite', options?.strict ? { durability: 'strict' } : undefined);
      tx.objectStore(RECORDS).put(record);
      await complete(tx);
    },
    async delete(id) {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).delete(id);
      await complete(tx);
    },
    async getMeta<T>(key: string) {
      const tx = db.transaction(META, 'readonly');
      return request<T | undefined>(tx.objectStore(META).get(key));
    },
    async setMeta(key, value) {
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put(value, key);
      await complete(tx);
    },
  };
}

// Pages and the worker read it: one short connection, closed at once. It rejects when the database cannot be read:
// an empty answer would make the router close the engine and drop rules, and the pages say there are no downloads.
export async function readAllRecords(): Promise<DlRecord[]> {
  const db = await openDb();
  try {
    return await request<DlRecord[]>(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).getAll());
  } finally {
    db.close();
  }
}
