import type { RunResult } from '@apps-hub/knowledge-core';

export interface PoolOptions {
  size: number;
  runNext(): Promise<RunResult>;
  active(): boolean;
  onTick(): void;
  onIdle(): void;
}

/**
 * Up to `size` loops pulling jobs. A pause (AI hub not answering, the owner has to act, a rate limit) halts the
 * current kick, so its loops stop and one kick never goes on hitting the hub with the rest of the queue; calls
 * already in flight finish. A later `start` opens a new kick: a loop still finishing a call from the halted one
 * moves over to it instead of stopping, so a Retry or a new capture is never left waiting. `start` adds loops only
 * up to `size`, so at most `size` calls are in flight across kicks.
 */
export function workerPool({ size, runNext, active, onTick, onIdle }: PoolOptions) {
  let running = 0;
  let current = { halted: false };

  async function loop(): Promise<void> {
    let mine = current;
    try {
      for (;;) {
        if (mine.halted) {
          if (current.halted) break;
          mine = current;
        }
        const result = await runNext();
        if (result === 'paused') mine.halted = true;
        if (result !== 'ran' || !active()) break;
        onTick();
      }
    } catch (err) {
      console.warn('Nexus worker stopped', err);
    } finally {
      running--;
      onIdle();
    }
  }

  return {
    start(): void {
      if (current.halted) current = { halted: false };
      while (running < size) {
        running++;
        void loop();
      }
    },
    running: () => running,
  };
}
