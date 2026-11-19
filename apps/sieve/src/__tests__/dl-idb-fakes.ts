// A minimal indexedDB for readAllRecords: open succeeds with the given records, or fails when `records` is an Error.
export function fakeIndexedDb(records: unknown[] | Error = []): void {
  const later = <T extends { onsuccess?: () => void; onerror?: () => void }>(r: T, ok: boolean) => (queueMicrotask(() => (ok ? r.onsuccess?.() : r.onerror?.())), r);
  const db = {
    close() {},
    transaction: () => ({ objectStore: () => ({ getAll: () => later({ result: records } as { result: unknown; onsuccess?: () => void; onerror?: () => void }, true) }) }),
  };
  (globalThis as unknown as Record<string, unknown>).indexedDB = {
    open: () => later({ result: db, error: records instanceof Error ? records : null } as { result: unknown; error: unknown; onsuccess?: () => void; onerror?: () => void }, !(records instanceof Error)),
  };
}
