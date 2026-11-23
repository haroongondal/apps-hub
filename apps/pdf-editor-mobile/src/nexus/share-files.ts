/** Writes only when the text differs from the last text written. A write that throws is retried next time. */
export function changedWriter(write: (text: string) => void): (text: string) => boolean {
  let last: string | null = null;
  return (text) => {
    if (text === last) return false;
    write(text);
    last = text;
    return true;
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
