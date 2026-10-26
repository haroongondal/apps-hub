/**
 * Node-only TCP probe used by tests and the smoke tool. NOT exported from
 * the package index: runtime code (React Native/Hermes) has no `node:net`,
 * so device probing wires the native module's probe in later phases.
 */
import net from 'node:net';
import { performance } from 'node:perf_hooks';

import type { TcpProbeFn } from './latency-prober.ts';

export function createNodeTcpProbe(): TcpProbeFn {
  return async (ip, port, timeoutMs) => {
    return await new Promise<number | null>((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (rttMs: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(rttMs);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      timer.unref?.();

      const startedAt = performance.now();
      socket.once('connect', () => {
        // Handshake complete: the RTT is all this probe needs; the socket is
        // destroyed immediately afterwards.
        finish(Math.max(1, Math.round(performance.now() - startedAt)));
      });
      socket.once('error', () => {
        // Reachability failures are the expected outcome for dead relays.
        finish(null);
      });

      socket.connect({ host: ip, port, family: 4 });
    });
  };
}
