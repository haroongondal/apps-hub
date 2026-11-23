// Fails closed: a failed write removes the file, so an older "on" never keeps serving.
export function closedFile(o: { write: (text: string) => void; remove: () => void }): { put: (text: string) => boolean; clear: () => void } {
  let last: string | null = null;
  const clear = () => {
    last = null;
    o.remove();
  };
  return {
    put(text) {
      if (text === last) return false;
      try {
        o.write(text);
      } catch (err) {
        clear();
        throw err;
      }
      last = text;
      return true;
    },
    clear,
  };
}

export const HEARTBEAT_GAP_MS = 60_000;

/** files/last_seen: decimal epoch ms, at most once a minute. */
export function createHeartbeat(o: { now: () => number; write: (text: string) => void; gapMs?: number }): { beat: () => boolean } {
  const gap = o.gapMs ?? HEARTBEAT_GAP_MS;
  let lastAt: number | null = null;
  return {
    beat() {
      const now = Math.floor(o.now());
      if (lastAt !== null && now - lastAt < gap) return false;
      try {
        o.write(String(now));
      } catch (err) {
        console.warn('Nexus could not write last_seen', err);
        return false;
      }
      lastAt = now;
      return true;
    },
  };
}
