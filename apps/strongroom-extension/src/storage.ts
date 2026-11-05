import { fromBase64, headerFromJson, headerToJson, toBase64 } from 'strongroom-core';
import type { RecordStore } from 'strongroom-core';
import type { KV } from './service.ts';

// Commits read-modify-write one storage key, so they run one at a time or two quick saves would overwrite each other.
let writing: Promise<unknown> = Promise.resolve();

export const localStore: RecordStore = {
  async getHeader() {
    const { header } = await chrome.storage.local.get('header');
    return typeof header === 'string' ? headerFromJson(header) : null;
  },
  async getRecords() {
    const { records = {} } = await chrome.storage.local.get('records');
    return Object.entries(records as Record<string, string>).map(([id, sealed]) => ({ id, sealed: fromBase64(sealed) }));
  },
  commit({ header, records }) {
    const run = async () => {
      const next: Record<string, unknown> = {};
      if (header) next.header = headerToJson(header);
      if (records?.length) {
        const { records: existing = {} } = await chrome.storage.local.get('records');
        next.records = { ...existing, ...Object.fromEntries(records.map((r) => [r.id, toBase64(r.sealed)])) };
      }
      await chrome.storage.local.set(next);
    };
    writing = writing.then(run, run);
    return writing as Promise<void>;
  },
};

export const sessionKv: KV = {
  get: async (key) => (await chrome.storage.session.get(key))[key],
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
  remove: (key) => chrome.storage.session.remove(key),
};
