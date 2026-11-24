import type { RunResult } from '@apps-hub/knowledge-core';

export interface PoolOptions {
  size: number;
  runNext(): Promise<RunResult>;
  active(): boolean;
  onTick(): void;
  onIdle(): void;
}

/**
 * Up to `size` loops pulling jobs. The first pause (AI hub not answering, the owner has to act, a rate limit)
 * stops every loop, so one kick never goes on hitting the hub with the rest of the queue; loops already
 * waiting on a call finish it. `start` after all loops ended begins again.
 */
export function workerPool({ size, runNext, active, onTick, onIdle }: PoolOptions) {
  let running = 0;
  let halted = false;

  async function loop(): Promise<void> {
    try {
      while (!halted) {
        const result = await runNext();
        if (result === 'paused') halted = true;
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
      if (running === 0) halted = false;
      while (running < size) {
        running++;
        void loop();
      }
    },
    running: () => running,
  };
}
