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

/** One queue for every today.json change: Off's remove and the switch write run in turn, so a refresh already under way cannot write after the remove. */
export function todayQueue(o: { file: { put: (text: string) => boolean; clear: () => void }; snapshot: () => Promise<string>; setOn: (on: boolean) => Promise<void> }) {
  let turn: Promise<unknown> = Promise.resolve();
  const refresh = async () => {
    try {
      o.file.put(await o.snapshot());
    } catch (err) {
      console.warn('Nexus could not update what is due today for other apps', err);
    }
  };
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = turn.then(step, step);
    turn = run.catch(() => undefined);
    return run;
  };
  return {
    refresh: () => enqueue(refresh),
    /** Off removes today.json before anything else; if that fails it throws, so the switch never reads Off while the file still serves. */
    set: (on: boolean) =>
      enqueue(async () => {
        if (!on) o.file.clear();
        await o.setOn(on);
        await refresh();
      }),
  };
}
