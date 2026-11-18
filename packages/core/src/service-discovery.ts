import type { ServiceEvent } from './model.ts';
import type { NetLensNativeBinding } from './native-binding.ts';

/** Android rejects a second startServiceDiscovery with this text (NetlensCoreModule.kt); the code is shared with the TCP scan, so match the text. */
export function isDiscoveryRunningError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return /service discovery is already running/i.test(typeof message === 'string' ? message : String(error));
}

/**
 * Runs one service discovery and returns the events that arrived. If another discovery is already running
 * (the scan's), it is not a failure: wait until that one completes or `durationMs` passes, then start one more and
 * collect from it (its replies went out before we listened). Any other
 * failure stops waiting and returns what arrived. `cancel()` removes the listeners and timers and ends the wait.
 */
export function collectServiceEvents(
  binding: Pick<NetLensNativeBinding, 'addListener' | 'startServiceDiscovery'>,
  durationMs: number,
  guardMs: number,
): { events: Promise<ServiceEvent[]>; cancel(): void } {
  const events: ServiceEvent[] = [];
  const wakers = new Set<() => void>();
  let cancelled = false;
  let resolveComplete!: () => void;
  const complete = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });
  const handles = [
    binding.addListener('onServiceDiscovered', (event) => {
      events.push(event);
    }),
    binding.addListener('onServiceScanComplete', () => resolveComplete()),
  ];
  // Resolves at `ms`, when `until` settles, or on cancel; its timer is always cleared.
  const wait = (ms: number, until?: Promise<unknown>): Promise<void> =>
    new Promise((resolve) => {
      if (cancelled) return resolve();
      const wake = (): void => {
        clearTimeout(timer);
        wakers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      wakers.add(wake);
      until?.then(wake, wake);
    });
  const cancel = (): void => {
    cancelled = true;
    for (const wake of [...wakers]) wake();
    for (const handle of handles) handle.remove();
  };
  const run = async (): Promise<ServiceEvent[]> => {
    const failures: unknown[] = [];
    const start = (): Promise<void> =>
      wait(guardMs, binding.startServiceDiscovery(durationMs).catch((error: unknown) => void failures.push(error)));
    await start();
    if (failures.length > 0 && isDiscoveryRunningError(failures[0])) {
      // That run's replies went out before we listened, so ask again once it ends. A second failure just ends here.
      await wait(durationMs, complete);
      if (!cancelled) await start();
    }
    cancel();
    return events;
  };
  return { events: run(), cancel };
}
