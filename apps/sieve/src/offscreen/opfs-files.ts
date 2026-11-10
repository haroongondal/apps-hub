import type { FileHandle, Files } from '@apps-hub/sieve-core/src/dl-ports.ts';

// Re-checked 2026-11-10 in Chrome for Testing 149.0.7827.55 (probe p10):
// - F16: a Worker streams 1 GB from a local server into an OPFS sync handle in 0.4 s and the browser's resident memory grows about 100 to 200 MB (does not follow the file).
// - F5: a second sync handle on a file that is already open fails with NoModificationAllowedError; truncate to 2.5 GiB is sparse and instant.
// - F6: navigator.storage.estimate() quota follows the free disk space (the manifest has unlimitedStorage).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openHandle(file: FileSystemFileHandle): Promise<FileSystemSyncAccessHandle> {
  // The handle of a just-paused transfer may still be closing.
  for (let attempt = 0; ; attempt++) {
    try {
      return await file.createSyncAccessHandle();
    } catch (e) {
      if ((e as Error).name !== 'NoModificationAllowedError' || attempt >= 5) throw e;
      await sleep(50);
    }
  }
}

export function createOpfsFiles(): Files {
  const root = () => navigator.storage.getDirectory();
  return {
    async open(name, length): Promise<FileHandle> {
      const file = await (await root()).getFileHandle(name, { create: true });
      const h = await openHandle(file);
      try {
        if (length !== null && h.getSize() !== length) h.truncate(length);
      } catch (e) {
        h.close();
        throw e;
      }
      return {
        write(chunk, at) {
          let done = 0;
          while (done < chunk.byteLength) {
            const n = h.write(chunk.subarray(done), { at: at + done });
            if (n <= 0) throw new Error('OPFS write returned no bytes');
            done += n;
          }
        },
        flush: () => h.flush(),
        size: () => h.getSize(),
        close: () => h.close(),
      };
    },
    async exists(name) {
      try {
        await (await root()).getFileHandle(name);
        return true;
      } catch (e) {
        if ((e as Error).name === 'NotFoundError') return false;
        throw e;
      }
    },
    async remove(name) {
      try {
        await (await root()).removeEntry(name);
      } catch (e) {
        if ((e as Error).name !== 'NotFoundError') throw e;
      }
    },
    async list() {
      const names: string[] = [];
      for await (const [name] of (await root()) as unknown as AsyncIterable<[string, unknown]>) names.push(name);
      return names;
    },
    async space() {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      return { quota, usage };
    },
  };
}
