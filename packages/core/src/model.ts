/**
 * Domain models for the NetLens networking engine.
 * Pure TS — the native module mirrors these shapes in its event payloads.
 */

/** FR-1: local interface facts reported by the native layer. */
export interface InterfaceInfo {
  localIp: string;
  cidrPrefix: number;
  gatewayIp: string | null;
}

/**
 * Result of one TCP probe classification.
 * HARD RULE (AGENTS.md): `refused` = TCP RST ⇒ the host is ALIVE.
 */
export type ProbeOutcome = 'open' | 'refused' | 'timeout' | 'unreachable';

/** A host emitted in real time while the subnet sweep runs. */
export interface DiscoveredHost {
  ip: string;
  /** true iff outcome is `open` or `refused` (RST = alive). */
  isReachable: boolean;
  /** Measured round-trip time to the successful connect or RST, in ms. */
  rttMs: number | null;
  /** The port that produced the winning probe, if any. */
  winningPort: number | null;
  outcome: ProbeOutcome;
}

export interface ServiceEvent {
  kind: 'mdns' | 'ssdp';
  /** mdns: service TYPE reported by the meta-query (e.g. "_http._tcp"). */
  serviceName?: string | null;
  /** ssdp: source address of the unicast response. */
  host?: string | null;
  /** ssdp: LOCATION header. */
  location?: string | null;
  /** ssdp: SERVER header. */
  server?: string | null;
  /** ssdp: USN header. */
  usn?: string | null;
}

export interface ScanCompletePayload {
  durationMs: number;
  /** Null-capable because native may not track counters in all paths. */
  totalProbed: number | null;
  hostsFound: number | null;
  cancelled: boolean;
}

export interface ServiceScanCompletePayload {
  mdnsCount: number;
  ssdpCount: number;
  cancelled: boolean;
}

/**
 * Fixed-shape events map. Extends the loose EventsMap record so the Expo
 * Modules native bridge accepts it as a typed events source.
 */
/**
 * Strict payload map used to type listener signatures. Kept separate from
 * ScanEventsMap because generic-indexed access must resolve to the exact
 * tuple types, not the loose record's index signature.
 */
export interface ScanEventPayloadMap {
  onHostDiscovered: readonly [host: DiscoveredHost];
  onScanComplete: readonly [payload: ScanCompletePayload];
  onServiceDiscovered: readonly [event: ServiceEvent];
  onServiceScanComplete: readonly [payload: ServiceScanCompletePayload];
}

/**
 * Listener-function map consumed by expo-modules-core's EventEmitter /
 * NativeModule (constraint: Record<string, (...args: any[]) => void>).
 */
export interface ScanEventsMap extends Record<string, (...args: any[]) => void> {
  onHostDiscovered: (host: DiscoveredHost) => void;
  onScanComplete: (payload: ScanCompletePayload) => void;
  onServiceDiscovered: (event: ServiceEvent) => void;
  onServiceScanComplete: (payload: ServiceScanCompletePayload) => void;
}

export type ScanEventName = keyof ScanEventPayloadMap;

export type ScanEventListener<E extends ScanEventName> = (
  ...args: ScanEventPayloadMap[E]
) => void;

export interface ListenerHandle {
  remove(): void;
}
