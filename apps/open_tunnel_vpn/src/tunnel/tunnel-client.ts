/**
 * Tunnel client — the app-facing state machine over the native binding
 * (phase 2 plan §7). Native `onStatusChanged` events are the single state
 * authority; `error` is terminal: the message is surfaced, no automatic
 * retry loop runs, and the listener stays attached so the next explicit
 * start transitions the machine out again. Traffic counters ride the
 * ~1 Hz `onTrafficUpdate` events and freeze off-UP (no ticks are emitted).
 */
import type { VpnNode } from 'open-tunnel-core';

import {
  OPEN_TUNNEL_ERROR_CODES,
  OpenTunnelError,
  buildTunnelConfigFromNode,
  type OpenTunnelBinding,
  type VpnStatusState,
} from 'open-tunnel-native';

export { buildTunnelConfigFromNode, OPEN_TUNNEL_ERROR_CODES, OpenTunnelError } from 'open-tunnel-native';
export type { VpnStatusState, VpnTunnelConfig } from 'open-tunnel-native';

export interface TunnelTrafficSnapshot {
  bytesIn: number;
  bytesOut: number;
  connectedDurationSec: number;
}

export interface TunnelSnapshot {
  state: VpnStatusState;
  /** Native failure wording when `state === 'error'`, else null. */
  message: string | null;
  /** Latest traffic tick; values freeze whenever emission stops. */
  traffic: TunnelTrafficSnapshot | null;
}

export type TunnelListener = (snapshot: TunnelSnapshot) => void;

export interface TunnelClient {
  getSnapshot(): TunnelSnapshot;
  subscribe(listener: TunnelListener): { remove(): void };
  /** Pulls the current native state — the process-restore read path. */
  refresh(): Promise<TunnelSnapshot>;
  /** Typed failure on rejection; snapshot reports `error` + message. */
  startTunnel(config: Parameters<OpenTunnelBinding['startTunnel']>[0]): Promise<TunnelSnapshot>;
  stopTunnel(): Promise<TunnelSnapshot>;
  openSystemVpnSettings(): Promise<boolean>;
  /** Composes the hand-off config from a decoded node (payload-derived). */
  configFromNode(
    node: VpnNode,
    options: { enableKillSwitch: boolean; disallowedApps?: readonly string[] },
  ): Parameters<OpenTunnelBinding['startTunnel']>[0];
  /** Removes the internal binding listeners (tests, teardown). */
  dispose(): void;
}

export function createTunnelClient(binding: OpenTunnelBinding): TunnelClient {
  let snapshot: TunnelSnapshot = {
    state: 'disconnected',
    message: null,
    traffic: null,
  };

  const listeners = new Set<TunnelListener>();

  function commit(next: TunnelSnapshot) {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  }

  function applyStatus(state: VpnStatusState, message?: string) {
    // `error` is terminal: only an explicit start (`connecting`) may leave
    // this state — later native events cannot silently resurrect it.
    if (snapshot.state === 'error' && state !== 'connecting') {
      return;
    }
    if (state === 'error') {
      commit({
        state: 'error',
        message: message ?? snapshot.message ?? 'tunnel error (native wording unavailable)',
        traffic: snapshot.traffic,
      });
      return;
    }
    // A new explicit start wipes the previous terminal message and resets
    // the frozen counters; the ticker re-seeds its baselines on start.
    if (state === 'connecting') {
      commit({ state, message: null, traffic: null });
      return;
    }
    commit({ state, message: null, traffic: snapshot.traffic });
  }

  const statusHandle = binding.addOnStatusChanged((payload) =>
    applyStatus(payload.state, payload.message),
  );
  const trafficHandle = binding.addOnTrafficUpdate((payload) => {
    commit({
      state: snapshot.state,
      message: snapshot.message,
      traffic: {
        bytesIn: payload.bytesIn,
        bytesOut: payload.bytesOut,
        connectedDurationSec: payload.connectedDurationSec,
      },
    });
  });

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    async refresh() {
      applyStatus(await binding.getState());
      return snapshot;
    },
    async startTunnel(config) {
      try {
        await binding.startTunnel(config);
        // The connecting event also arrives from native; setting it here as
        // well makes the hand-off state deterministic for the caller.
        applyStatus('connecting');
      } catch (error) {
        applyStatus('error', describeError(error));
      }
      return snapshot;
    },
    async stopTunnel() {
      try {
        await binding.stopTunnel();
      } catch (error) {
        applyStatus('error', describeError(error));
      }
      return snapshot;
    },
    async openSystemVpnSettings() {
      return binding.openSystemVpnSettings();
    },
    configFromNode(node, options) {
      return buildTunnelConfigFromNode(node, {
        enableKillSwitch: options.enableKillSwitch,
        disallowedApps: options.disallowedApps,
      });
    },
    // Listeners stay attached for the client lifetime by default (plan §7:
    // a terminal error never detaches the machine); dispose is explicit.
    dispose() {
      statusHandle.remove();
      trafficHandle.remove();
    },
  };
}

/**
 * Snapshot wording for a tunnel call failure. Native rejections arrive as
 * Expo `CodedError`s — `code` (one of `OPEN_TUNNEL_ERROR_CODES`) plus the
 * reason as `message` — so their typed code surfaces verbatim. A plain
 * error keeps the conservative start-failure code; the reason text is
 * still quoted word for word.
 */
function describeError(error: unknown): string {
  if (error instanceof OpenTunnelError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message.length > 0) {
    const nativeCode = (error as { code?: unknown }).code;
    const code =
      typeof nativeCode === 'string' && isTunnelErrorCode(nativeCode)
        ? nativeCode
        : OPEN_TUNNEL_ERROR_CODES.SERVICE_START_FAILED;
    return `${code}: ${error.message}`;
  }
  return `${OPEN_TUNNEL_ERROR_CODES.SERVICE_START_FAILED}: tunnel call failed (${typeof error})`;
}

function isTunnelErrorCode(code: string): boolean {
  return (Object.values(OPEN_TUNNEL_ERROR_CODES) as readonly string[]).includes(code);
}
