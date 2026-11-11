// Helpers for the dl e2e modules. Everything reads and writes through one extension page (the "hub"), never through the
// service worker, so a stopped worker stays stopped until a test sends it a message.
import { validateDownloadSettings } from '@apps-hub/sieve-core/src/dl-settings.ts';

export async function extPage(t, file = 'options.html') {
  const page = await t.ctx.newPage();
  page.on('pageerror', (e) => t.errors.push(e.message));
  await page.goto(`chrome-extension://${t.id}/${file}`);
  return page;
}

const hubs = new WeakMap();
async function hub(t) {
  let page = hubs.get(t);
  if (!page || page.isClosed()) {
    page = await extPage(t, 'options.html');
    hubs.set(t, page);
  }
  return page;
}
const inPage = async (t, fn, arg) => (await hub(t)).evaluate(fn, arg);

export const sendMsg = (t, message) => inPage(t, (m) => chrome.runtime.sendMessage(m), message);

export const engineCount = (t) => inPage(t, async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length);

export const readRecords = (t) =>
  inPage(t, async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'sieve-dl')) return [];
    const db = await new Promise((resolve, reject) => Object.assign(indexedDB.open('sieve-dl'), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
    try {
      if (!db.objectStoreNames.contains('records')) return [];
      return await new Promise((resolve, reject) => Object.assign(db.transaction('records').objectStore('records').getAll(), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
    } finally {
      db.close();
    }
  });

export const readMeta = (t, key) =>
  inPage(
    t,
    async (k) => {
      if (!(await indexedDB.databases()).some((d) => d.name === 'sieve-dl')) return undefined;
      const db = await new Promise((resolve, reject) => Object.assign(indexedDB.open('sieve-dl'), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
      try {
        if (!db.objectStoreNames.contains('meta')) return undefined;
        return await new Promise((resolve, reject) => Object.assign(db.transaction('meta').objectStore('meta').get(k), { onsuccess: (e) => resolve(e.target.result), onerror: (e) => reject(e.target.error) }));
      } finally {
        db.close();
      }
    },
    key,
  );

export const localGet = (t, keyOrNull) => inPage(t, (k) => chrome.storage.local.get(k), keyOrNull);
export const sessionGet = (t, keyOrNull) => inPage(t, (k) => chrome.storage.session.get(k), keyOrNull);

export async function setDownloads(t, patch) {
  const current = (await localGet(t, 'downloads')).downloads;
  const next = validateDownloadSettings({ ...validateDownloadSettings(current), ...patch });
  await inPage(t, (v) => chrome.storage.local.set({ downloads: v }), next);
}

export const opfsNames = (t) =>
  inPage(t, async () => {
    const names = [];
    for await (const [name] of (await navigator.storage.getDirectory()).entries()) names.push(name);
    return names;
  });

export const deletePart = (t, name) =>
  inPage(t, async (n) => (await navigator.storage.getDirectory()).removeEntry(n), name);

// byte i of the fixture is i % 251; `ok` compares every byte, in 1 MiB slices.
export const readPart = (t, name) =>
  inPage(
    t,
    async (n) => {
      const root = await navigator.storage.getDirectory();
      let file;
      try {
        file = await (await root.getFileHandle(n)).getFile();
      } catch {
        return { size: -1, ok: false };
      }
      const SLICE = 1 << 20;
      for (let off = 0; off < file.size; off += SLICE) {
        const bytes = new Uint8Array(await file.slice(off, Math.min(off + SLICE, file.size)).arrayBuffer());
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== (off + i) % 251) return { size: file.size, ok: false };
      }
      return { size: file.size, ok: true };
    },
    name,
  );

export async function until(fn, ms = 10000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`until timed out; last value: ${last instanceof Error ? last.message : JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Closes the engine, deletes IndexedDB `sieve-dl` and every OPFS entry, and removes the `downloads` key and every `dl*` key.
export async function resetDl(t) {
  await inPage(t, async () => {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // none open
    }
  });
  await until(async () => (await engineCount(t)) === 0);
  await inPage(t, async () => {
    // The engine's connections close on `versionchange`, so this does not hang.
    await new Promise((resolve, reject) => Object.assign(indexedDB.deleteDatabase('sieve-dl'), { onsuccess: resolve, onerror: reject, onblocked: () => {} }));
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
    const local = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(local).filter((k) => k === 'downloads' || k.startsWith('dl')));
    const session = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(session).filter((k) => k.startsWith('dl')));
  });
  await until(async () => (await engineCount(t)) === 0);
}
