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

export type FirewallRuleKind = 'allow' | 'block_on_mobile' | 'block_always';

export type FirewallVerdict = 'allowed' | 'blocked';

export type PrivateDnsMode = 'off' | 'automatic' | 'strict';

export interface PrivateDnsStatus {
  mode: PrivateDnsMode;
  /** The provider's host name, only in strict mode. */
  provider: string | null;
}

export interface FirewallStatus {
  /** The user's switch. */
  enabled: boolean;
  /** The firewall process is up and filtering. */
  running: boolean;
  /** Stopped by the user's Pause; the notification stays with Resume. */
  paused: boolean;
  /** The Usage access grant that data use needs. */
  usageAccess: boolean;
  privateDns: PrivateDnsStatus;
}

export interface AppRule {
  uid: number;
  pkg: string;
  label: string;
  rule: FirewallRuleKind;
}

export interface ActivityEntry {
  timestampMs: number;
  uid: number;
  /** Package name, or `Unknown app` when the owner could not be resolved. */
  pkg: string;
  proto: string;
  dst: string;
  dstPort: number;
  domain: string | null;
  bytesOut: number;
  bytesIn: number;
  verdict: FirewallVerdict;
}

export interface DataUseRow {
  uid: number;
  wifiBytes: number;
  cellBytes: number;
}

export interface ActivityFilter {
  uid?: number;
  blockedOnly: boolean;
  /** Newest first; defaults to 1000, at most 10000. */
  limit?: number;
}

export interface FirewallApi {
  getFirewallStatus(): Promise<FirewallStatus>;
  setFirewallEnabled(on: boolean): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  getAppRules(): Promise<AppRule[]>;
  setAppRule(uid: number, rule: FirewallRuleKind): Promise<void>;
  getActivityLog(filter: ActivityFilter): Promise<ActivityEntry[]>;
  clearActivityLog(): Promise<void>;
  /** Data use since `sinceMs` (epoch milliseconds, not in the future). */
  getDataUse(sinceMs: number): Promise<DataUseRow[]>;
  openUsageAccessSettings(): Promise<void>;
}

/** Rows as Kotlin sends them: enum names, unmapped (`FirewallRule`, `Verdict`). */
export interface NativeAppRule {
  uid: number;
  pkg: string;
  label: string;
  rule: string;
}

export interface NativeLogRow {
  timestampMs: number;
  uid: number;
  pkg: string;
  proto: string;
  dst: string;
  dstPort: number;
  domain: string | null;
  bytesOut: number;
  bytesIn: number;
  verdict: string;
}

export interface FirewallNativeApi {
  getFirewallStatus(): Promise<FirewallStatus>;
  setFirewallEnabled(on: boolean): Promise<null>;
  setPaused(paused: boolean): Promise<null>;
  getAppRules(): Promise<NativeAppRule[]>;
  setAppRule(uid: number, rule: string): Promise<null>;
  getActivityLog(uid: number | null, blockedOnly: boolean, limit: number): Promise<NativeLogRow[]>;
  clearActivityLog(): Promise<null>;
  getDataUse(sinceMs: number): Promise<DataUseRow[]>;
  openUsageAccessSettings(): Promise<null>;
}

export interface OpenTunnelNativeApi extends FirewallNativeApi {
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
  FIREWALL_NOT_SUPPORTED: 'ERR_FIREWALL_NOT_SUPPORTED',
  FIREWALL_FAILED: 'ERR_FIREWALL_FAILED',
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
