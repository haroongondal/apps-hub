/**
 * The `TcpProbeFn` handed to `new LatencyProber(...)` — wired to the native
 * module's single-connect probe (phase 2 plan §5). Bounded concurrency and
 * the 1500 ms default stay in the prober (its own defaults), so no timeout
 * constant is duplicated here.
 *
 * Transport-level typed failures degrade to null, which is the prober's
 * "offline" contract — the upstream static ping then remains the fitness
 * input (AGENTS: probing failure keeps static ping as fallback). The socket
 * itself is destroyed by the native side immediately after the attempt.
 */
import { createOpenTunnelBinding } from 'open-tunnel-native';

/** Shared live binding for this app run (typed fail-fast on iOS). */
export const openTunnelBinding = createOpenTunnelBinding();

export const nativeTcpProbe: (ip: string, port: number, timeoutMs: number) => Promise<number | null> =
  async (ip, port, timeoutMs) => {
    try {
      return await openTunnelBinding.tcpProbe(ip, port, timeoutMs);
    } catch {
      // Transport failure ⇒ no measurement; the prober falls back to the
      // static VPN Gate ping for that candidate.
      return null;
    }
  };
