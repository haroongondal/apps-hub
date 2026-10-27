/**
 * JavaScript contract of the `OpenTunnelNative` Expo module (phase 2 plan
 * §4.1). The Kotlin module (expo.modules.opentunnelnative) implements the
 * Android half; the Swift module (OpenTunnelNativeModule.swift, phase 3)
 * implements the iOS half, so the binding now binds the native seam on
 * both mobile platforms and degrades typed where the pod is absent.
 *
 * Where the module is absent the `requireNativeModule` call must not run at
 * import time — it is therefore exported as a helper, not as a default
 * instance. Status strings mirror `TunnelStatus.kt` exactly.
 */

export type VpnProtocol = 'openvpn' | 'wireguard';

export type VpnStatusState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'reasserting'
  | 'error';

export interface VpnTunnelConfig {
  /** UI-facing metadata; the engine reads `configText` for the truth. */
  nodeId: string;
  serverIp: string;
  /** From `extractRemote()` or the UI default. */
  serverPort: number;
  /** Payload-derived via `detectVpnProtocol()` — never the endpoint name. */
  protocol: VpnProtocol;
  /** Opaque already-sanitized engine payload (`.conf` or `.ovpn`). */
  configText: string;
  dnsServers: string[];
  /** Engine drop-all when true; never via the VpnService bypass opt-out. */
  enableKillSwitch: boolean;
  /** Routed to the engine's excluded-apps mechanism; picker lands Phase 4. */
  disallowedApps: string[];
}

export interface VpnStatusPayload {
  state: VpnStatusState;
  message?: string;
}

export interface VpnTrafficPayload {
  bytesIn: number;
  bytesOut: number;
  connectedDurationSec: number;
}

export interface OpenTunnelNativeApi {
  startTunnel(config: VpnTunnelConfig): Promise<null>;
  stopTunnel(): Promise<null>;
  getState(): Promise<VpnStatusState>;
  openSystemVpnSettings(): Promise<boolean>;
  /** Single-connect TCP RTT measurement; null when offline/unreachable. */
  tcpProbe(ip: string, port: number, timeoutMs: number): Promise<number | null>;
  addListener(
    event: 'onStatusChanged',
    listener: (payload: VpnStatusPayload) => void,
  ): { remove(): void };
  addListener(
    event: 'onTrafficUpdate',
    listener: (payload: VpnTrafficPayload) => void,
  ): { remove(): void };
}

/** Typed native rejects (Expo `Promise.reject` codes, plan §4.1). The
 * probe's parameter-validation code (netlens-style `ERR_INVALID_PARAMS`)
 * is module-side and surfaced on transport-independent misuse. */
export const OPEN_TUNNEL_ERROR_CODES = {
  INVALID_CONFIG: 'ERR_INVALID_CONFIG',
  INVALID_PARAMS: 'ERR_INVALID_PARAMS',
  NO_CONTEXT: 'ERR_NO_CONTEXT',
  ENGINE_UNAVAILABLE: 'ERR_ENGINE_UNAVAILABLE',
  SERVICE_START_FAILED: 'ERR_SERVICE_START_FAILED',
  PROBE_FAILED: 'ERR_PROBE_FAILED',
} as const;

export type OpenTunnelErrorCode =
  (typeof OPEN_TUNNEL_ERROR_CODES)[keyof typeof OPEN_TUNNEL_ERROR_CODES];

/** Typed failure the binding/Bridge surfaces — same taxonomy as native. */
export class OpenTunnelError extends Error {
  readonly code: OpenTunnelErrorCode;

  constructor(code: OpenTunnelErrorCode, message: string) {
    super(message);
    this.name = 'OpenTunnelError';
    this.code = code;
  }
}

export const OPEN_TUNNEL_MODULE_NAME = 'OpenTunnelNative';
