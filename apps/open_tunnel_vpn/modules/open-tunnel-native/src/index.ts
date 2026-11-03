/**
 * OpenTunnel native binding (Expo local module `open-tunnel-native`).
 *
 * `createOpenTunnelBinding()` is the single seam the app consumes; iOS and
 * non-run environments get the typed fail-fast semantics of plan §4.3 —
 * `startTunnel`/`stopTunnel` reject `ERR_ENGINE_UNAVAILABLE`, `getState`
 * resolves `disconnected` (the true state), `openSystemVpnSettings`
 * resolves false. No native stubs masquerade as a working bridge.
 *
 * Pure helpers (`validateTunnelConfig`, `buildTunnelConfigFromNode`,
 * `normalizeStatusState`) are Hermes-safe and unit-testable on Node
 * directly; nothing at import time touches the native registry except on
 * Android. (requireNativeModule reads 'expo'.)
 */
import { detectVpnProtocol, extractRemote, type VpnNode } from 'open-tunnel-core';

import {
  OPEN_TUNNEL_ERROR_CODES,
  OPEN_TUNNEL_MODULE_NAME,
  OpenTunnelError,
  type ActivityEntry,
  type ActivityFilter,
  type AppRule,
  type DataUseRow,
  type FirewallApi,
  type FirewallNativeApi,
  type FirewallRuleKind,
  type FirewallStatus,
  type FirewallVerdict,
  type NativeAppRule,
  type NativeLogRow,
  type OpenTunnelNativeApi,
  type VpnProtocol,
  type VpnStatusPayload,
  type VpnStatusState,
  type VpnTrafficPayload,
  type VpnTunnelConfig,
} from './OpenTunnelNativeModule.ts';

export {
  OPEN_TUNNEL_ERROR_CODES,
  OPEN_TUNNEL_MODULE_NAME,
  OpenTunnelError,
} from './OpenTunnelNativeModule.ts';
export type {
  ActivityEntry,
  ActivityFilter,
  AppRule,
  DataUseRow,
  FirewallApi,
  FirewallNativeApi,
  FirewallRuleKind,
  FirewallStatus,
  FirewallVerdict,
  NativeAppRule,
  NativeLogRow,
  OpenTunnelErrorCode,
  OpenTunnelNativeApi,
  VpnProtocol,
  VpnStatusPayload,
  VpnStatusState,
  VpnTrafficPayload,
  VpnTunnelConfig,
} from './OpenTunnelNativeModule.ts';

export type RuntimePlatform = 'android' | 'ios' | 'unavailable';

export type VpnStatusListener = (payload: VpnStatusPayload) => void;
export type VpnTrafficListener = (payload: VpnTrafficPayload) => void;

export interface ListenerHandle {
  remove(): void;
}

export interface OpenTunnelBinding {
  startTunnel(config: VpnTunnelConfig): Promise<null>;
  stopTunnel(): Promise<null>;
  getState(): Promise<VpnStatusState>;
  openSystemVpnSettings(): Promise<boolean>;
  /** Single-connect TCP probe; RTT ms, or null when unreachable/offline. */
  tcpProbe(ip: string, port: number, timeoutMs: number): Promise<number | null>;
  addOnStatusChanged(listener: VpnStatusListener): ListenerHandle;
  addOnTrafficUpdate(listener: VpnTrafficListener): ListenerHandle;
}

export const STATUS_STATES: readonly VpnStatusState[] = [
  'disconnected',
  'connecting',
  'connected',
  'disconnecting',
  'reasserting',
  'error',
];

export const DEFAULT_DNS_SERVERS: readonly string[] = ['1.1.1.1', '9.9.9.9'];

/**
 * Detects the runtime platform without static `react-native` imports so
 * this module stays loadable under Node (unit tests). Mobile runtimes
 * always have React Native, so resolution failure means "not on device".
 */
export function runtimePlatform(): RuntimePlatform {
  try {
    // Statically analyzable require — Metro bundles it; Node throwing here
    // is the signal this helper relies on ("not on device").
    const reactNative: { Platform?: { OS?: string } } = require('react-native');
    const os = reactNative?.Platform?.OS;
    if (os === 'android') return 'android';
    if (os === 'ios') return 'ios';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Coerces an untrusted status string to the contract; unknown values map
 * to `disconnected` (conservative default, mirroring the netlens binding).
 */
export function normalizeStatusState(raw: unknown): VpnStatusState {
  return STATUS_STATES.includes(raw as VpnStatusState)
    ? (raw as VpnStatusState)
    : 'disconnected';
}

function isProtocol(value: unknown): value is VpnProtocol {
  return value === 'openvpn' || value === 'wireguard';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 65535 &&
    Number.isFinite(value)
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Strict contract validation for `VpnTunnelConfig`. Throws
 * `OpenTunnelError(ERR_INVALID_CONFIG)` with a precise message on any
 * deviation — the same taxonomy the native side enforces.
 */
export function validateTunnelConfig(value: unknown): VpnTunnelConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'tunnel config must be an object',
    );
  }
  const raw = value as Record<string, unknown>;

  if (!isNonEmptyString(raw.nodeId)) {
    throw new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG, 'nodeId missing');
  }
  if (!isNonEmptyString(raw.serverIp)) {
    throw new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG, 'serverIp missing');
  }
  if (!isPort(raw.serverPort)) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'serverPort out of range',
    );
  }
  if (!isProtocol(raw.protocol)) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'protocol must be openvpn or wireguard',
    );
  }
  if (!isNonEmptyString(raw.configText) || raw.configText.trim().length === 0) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'configText missing or empty',
    );
  }
  if (!isStringList(raw.dnsServers)) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'dnsServers must be a string list',
    );
  }
  if (typeof raw.enableKillSwitch !== 'boolean') {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'enableKillSwitch must be boolean',
    );
  }
  if (!isStringList(raw.disallowedApps)) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      'disallowedApps must be a string list',
    );
  }

  const normalized: VpnTunnelConfig = {
    nodeId: raw.nodeId.trim(),
    serverIp: raw.serverIp.trim(),
    serverPort: raw.serverPort,
    protocol: raw.protocol,
    configText: raw.configText,
    dnsServers: raw.dnsServers,
    enableKillSwitch: raw.enableKillSwitch,
    disallowedApps: raw.disallowedApps,
  };

  // Payload routing parity (AGENTS rule #1): the declared protocol must
  // agree with the sniffed payload; the native module re-verifies the same
  // logic, so the two layers cannot silently disagree.
  const sniffed = detectVpnProtocol(normalized.configText);
  if (sniffed !== normalized.protocol) {
    throw new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.INVALID_CONFIG,
      `declared protocol ${normalized.protocol} does not match the ${sniffed} payload`,
    );
  }

  return normalized;
}

export interface TunnelConfigOptions {
  /** Real in-engine packet blocking choice (never the bypass opt-out). */
  enableKillSwitch: boolean;
  /** Optional DNS override; defaults to the documented baseline. */
  dnsServers?: readonly string[];
  /** Optional app-id exclusion list (picker arrives Phase 4). */
  disallowedApps?: readonly string[];
}

/**
 * Builds the hand-off config from a decoded `VpnNode`. The protocol and
 * the endpoint come from the payload (sniff + extractRemote), never from
 * the node's display name; the port falls back to the node's upstream
 * parsed default (1194) when the payload carries no `remote` line.
 */
export function buildTunnelConfigFromNode(
  node: VpnNode,
  options: TunnelConfigOptions,
): VpnTunnelConfig {
  const remote = extractRemote(node.ovpnConfigRaw);
  return validateTunnelConfig({
    nodeId: node.id,
    serverIp: node.ip,
    serverPort: remote.port ?? node.port,
    protocol: detectVpnProtocol(node.ovpnConfigRaw),
    configText: node.ovpnConfigRaw,
    dnsServers:
      options.dnsServers === undefined ? [...DEFAULT_DNS_SERVERS] : [...options.dnsServers],
    enableKillSwitch: options.enableKillSwitch,
    disallowedApps:
      options.disallowedApps === undefined ? [] : [...options.disallowedApps],
  });
}

interface BindingOptions {
  /** Exposed for tests; runtime detection applies when omitted. */
  platform?: RuntimePlatform;
}

/** Typed fail-fast binding for runtimes without the native module. */
function unavailableBinding(platform: RuntimePlatform): OpenTunnelBinding {
  const engineUnavailable = () =>
    new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.ENGINE_UNAVAILABLE,
      platform === 'ios'
        ? 'the OpenTunnelNative iOS module is not installed in this runtime (pod install/autolinking or a test host without the pod)'
        : 'native tunnel engine unavailable on this runtime',
    );

  return {
    async startTunnel(): Promise<null> {
      throw engineUnavailable();
    },
    async stopTunnel(): Promise<null> {
      throw engineUnavailable();
    },
    async getState(): Promise<VpnStatusState> {
      // The true state on a runtime that cannot host a tunnel.
      return 'disconnected';
    },
    async openSystemVpnSettings(): Promise<boolean> {
      return false;
    },
    async tcpProbe(): Promise<number | null> {
      throw new OpenTunnelError(
        OPEN_TUNNEL_ERROR_CODES.PROBE_FAILED,
        platform === 'ios'
          ? 'the native TCP probe ships with the OpenTunnelNative iOS module, which is not installed in this runtime'
          : 'the native TCP probe is unavailable on this runtime',
      );
    },
    addOnStatusChanged(_listener: VpnStatusListener): ListenerHandle {
      return { remove: () => undefined };
    },
    addOnTrafficUpdate(_listener: VpnTrafficListener): ListenerHandle {
      return { remove: () => undefined };
    },
  };
}

/**
 * Resolves the native seam for a mobile platform, degrading typed when
 * the module is genuinely absent (pod not installed, test host). Node
 * environments are still excluded at the platform gate — the require of
 * `expo` only runs on a real mobile runtime (type-stripping inside
 * node_modules is unsupported for Node, phase-2 finding).
 */
function resolveNativeModule(platform: RuntimePlatform): OpenTunnelNativeApi | null {
  try {
    const { requireNativeModule } = require('expo') as {
      requireNativeModule: <T>(moduleName: string) => T;
    };
    return requireNativeModule<OpenTunnelNativeApi>(OPEN_TUNNEL_MODULE_NAME);
  } catch {
    // Module not registered in this runtime (pod not installed yet, or a
    // test host): the typed uni-available path handles it — no invented
    // engine objects (plan §4.3).
    return null;
  }
}

export function createOpenTunnelBinding(options?: BindingOptions): OpenTunnelBinding {
  const platform = options?.platform ?? runtimePlatform();
  if (platform !== 'android' && platform !== 'ios') {
    return unavailableBinding(platform);
  }

  // iOS now binds the real native module (the Swift half of the Expo
  // module); when the pod is absent from this build, the resolver degrades
  // typed instead of throwing unstructured.
  const native = resolveNativeModule(platform);
  if (native == null) {
    return unavailableBinding(platform);
  }

  return {
    async startTunnel(config): Promise<null> {
      const validated = validateTunnelConfig(config);
      await native.startTunnel(validated);
      return null;
    },
    async stopTunnel(): Promise<null> {
      await native.stopTunnel();
      return null;
    },
    async getState(): Promise<VpnStatusState> {
      return normalizeStatusState(await native.getState());
    },
    async openSystemVpnSettings(): Promise<boolean> {
      return (await native.openSystemVpnSettings()) === true;
    },
    async tcpProbe(ip, port, timeoutMs): Promise<number | null> {
      const rtt = await native.tcpProbe(ip, port, timeoutMs);
      return typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 0 ? rtt : null;
    },
    addOnStatusChanged(listener: VpnStatusListener): ListenerHandle {
      const subscription = native.addListener('onStatusChanged', listener);
      return { remove: () => subscription.remove() };
    },
    addOnTrafficUpdate(listener: VpnTrafficListener): ListenerHandle {
      const subscription = native.addListener('onTrafficUpdate', listener);
      return { remove: () => subscription.remove() };
    },
  };
}

const RULE_WIRE: Record<FirewallRuleKind, string> = {
  allow: 'ALLOW',
  block_on_mobile: 'BLOCK_ON_MOBILE',
  block_always: 'BLOCK_ALWAYS',
};

const VERDICT_FROM_WIRE: Record<string, FirewallVerdict> = {
  ALLOW: 'allowed',
  BLOCK: 'blocked',
};

export const UNKNOWN_APP_LABEL = 'Unknown app';
export const DEFAULT_ACTIVITY_LIMIT = 1000;
export const MAX_ACTIVITY_LIMIT = 10_000;

/** The one place a TS rule kind becomes the Kotlin `FirewallRule` name. */
export function ruleToWire(kind: FirewallRuleKind): string {
  // Object.hasOwn: a plain lookup of 'constructor' would return a function, not throw.
  if (!Object.hasOwn(RULE_WIRE, kind)) {
    throw new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS, `unknown firewall rule ${String(kind)}`);
  }
  return RULE_WIRE[kind];
}

export function ruleFromWire(wire: string): FirewallRuleKind {
  const kind = (Object.keys(RULE_WIRE) as FirewallRuleKind[]).find((key) => RULE_WIRE[key] === wire);
  if (kind === undefined) {
    throw new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED, `unknown firewall rule ${wire} from the native module`);
  }
  return kind;
}

/** A row is `blocked` only when Kotlin says BLOCK; an unknown verdict is an error, never a guess. */
export function verdictFromWire(wire: string): FirewallVerdict {
  if (!Object.hasOwn(VERDICT_FROM_WIRE, wire)) {
    throw new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED, `unknown verdict ${wire} from the native module`);
  }
  return VERDICT_FROM_WIRE[wire];
}

function toActivityEntry(row: NativeLogRow): ActivityEntry {
  // The log stores the machine string for a UID it could not resolve; the UI shows the label.
  const unresolved = row.uid < 0 || row.pkg === 'unknown';
  return { ...row, pkg: unresolved ? UNKNOWN_APP_LABEL : row.pkg, verdict: verdictFromWire(row.verdict) };
}

function invalidParams(message: string): OpenTunnelError {
  return new OpenTunnelError(OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS, message);
}

export function bindFirewall(native: FirewallNativeApi): FirewallApi {
  return {
    getFirewallStatus: () => native.getFirewallStatus(),
    async setFirewallEnabled(on): Promise<void> {
      await native.setFirewallEnabled(on);
    },
    async setPaused(paused): Promise<void> {
      await native.setPaused(paused);
    },
    async getAppRules() {
      const rows = await native.getAppRules();
      return rows.map((row) => ({ ...row, rule: ruleFromWire(row.rule) }));
    },
    async setAppRule(uid, rule): Promise<void> {
      if (!Number.isSafeInteger(uid) || uid < 0) throw invalidParams('uid must be a non-negative integer');
      await native.setAppRule(uid, ruleToWire(rule));
    },
    async getActivityLog(filter) {
      const limit = filter.limit ?? DEFAULT_ACTIVITY_LIMIT;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ACTIVITY_LIMIT) {
        throw invalidParams(`limit must be 1..${MAX_ACTIVITY_LIMIT}`);
      }
      const rows = await native.getActivityLog(filter.uid ?? null, filter.blockedOnly, limit);
      return rows.map(toActivityEntry);
    },
    async clearActivityLog(): Promise<void> {
      await native.clearActivityLog();
    },
    async getDataUse(sinceMs) {
      if (!Number.isFinite(sinceMs) || sinceMs < 0) throw invalidParams('sinceMs must be a time in milliseconds');
      return native.getDataUse(sinceMs);
    },
    async openUsageAccessSettings(): Promise<void> {
      await native.openUsageAccessSettings();
    },
  };
}

function unsupportedFirewall(platform: RuntimePlatform): FirewallApi {
  const unsupported = () =>
    new OpenTunnelError(
      OPEN_TUNNEL_ERROR_CODES.FIREWALL_NOT_SUPPORTED,
      platform === 'ios'
        ? "The firewall isn't available on iOS."
        : "The firewall isn't available in this runtime.",
    );
  const reject = async (): Promise<never> => {
    throw unsupported();
  };
  return {
    getFirewallStatus: reject,
    setFirewallEnabled: reject,
    setPaused: reject,
    getAppRules: reject,
    setAppRule: reject,
    getActivityLog: reject,
    clearActivityLog: reject,
    getDataUse: reject,
    openUsageAccessSettings: reject,
  };
}

/** The firewall seam the Firewall screen consumes; typed `FIREWALL_NOT_SUPPORTED` where there is no firewall. */
export function createFirewallBinding(options?: BindingOptions): FirewallApi {
  const platform = options?.platform ?? runtimePlatform();
  if (platform !== 'android') return unsupportedFirewall(platform);
  const native = resolveNativeModule(platform);
  return native == null ? unsupportedFirewall(platform) : bindFirewall(native);
}
