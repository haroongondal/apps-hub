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
  kind: 'mdns' | 'ssdp' | 'mdns-instance';
  /** mdns: service TYPE reported by the meta-query (e.g. "_http._tcp"). */
  serviceName?: string | null;
  /** ssdp: source address of the unicast response. mdns-instance: the instance's IPv4. */
  host?: string | null;
  /** ssdp: LOCATION header. */
  location?: string | null;
  /** ssdp: SERVER header. */
  server?: string | null;
  /** ssdp: USN header. */
  usn?: string | null;
  /** mdns-instance: the instance's name, before cleaning. */
  instanceName?: string | null;
  /** mdns-instance: service type the instance answered for (e.g. "_airplay._tcp"). */
  serviceType?: string | null;
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

// ---------------------------------------------------------------------------
// Phase 2 — Connectivity & Latency Diagnostic Engine (FR-3, SPEC §5)
// ---------------------------------------------------------------------------

/**
 * Result of one native TCP handshake measurement. HARD RULE (AGENTS.md #2):
 * BOTH an `open` connect and a `refused` response (TCP RST carrier) carry a
 * measured RTT; only `timeout` / `unreachable` come back with null.
 */
export interface TcpHandshakeResult {
  outcome: ProbeOutcome;
  /** Round-trip in ms when the outcome is `open` or `refused`, else null. */
  rttMs: number | null;
}

/**
 * One OS resolver round-trip measured natively (Android `InetAddress`
 * / iOS `getaddrinfo`). A failed lookup is still a valid (failed)
 * measurement: `success: false` keeps the elapsed wall time.
 */
export interface DnsResolution {
  hostname: string;
  addresses: string[];
  /** Elapsed resolver wall time in ms. */
  durationMs: number;
  /** false when the resolver returned no usable address. */
  success: boolean;
}

/** The three FR-3 diagnostic hops, in measurement order (SPEC §5). */
export type PingHopName = 'gateway' | 'wan_cloudflare' | 'wan_google';

/** One sequential probe sample inside a PingEngine burst. */
export interface PingProbeSample {
  /** Zero-based position within the burst (0..probeCount-1). */
  index: number;
  /** TCP port probed; gateway bursts rotate their port plan. */
  port: number;
  outcome: ProbeOutcome;
  /**
   * Valid RTT sample (`open` | `refused` carrier); null ⇒ this probe counts
   * as packet loss.
   */
  rttMs: number | null;
}

/** SPEC §5 metrics computed from one hop's samples. */
export interface HopMetrics {
  /** Mean of valid RTT samples; null when none carried an RTT. */
  avgRttMs: number | null;
  /** Mean absolute difference between consecutive valid RTTs; null when < 2. */
  jitterMs: number | null;
  /** failed/total × 100 over the whole burst. */
  packetLossPct: number;
}

/** One completed PingEngine hop burst. */
export interface PingHopResult {
  hop: PingHopName;
  targetIp: string;
  probeCount: number;
  /** TCP port for single-port hops; null for the rotating gateway burst. */
  port: number | null;
  samples: PingProbeSample[];
  metrics: HopMetrics;
}

/** Full per-hop result of one PingEngine run. */
export interface PingReport {
  hops: PingHopResult[];
  /** The gateway burst, or null when no gateway was detectable (NFR-3). */
  gateway: PingHopResult | null;
}

/** Aggregated DnsBenchmark result — the SPEC §5 `dnsResolveMs` input. */
export interface DnsBenchmarkResult {
  hostname: string;
  /** Mean resolver wall time over SUCCESSFUL attempts; null if all failed. */
  resolveMs: number | null;
  /** Union of addresses seen across successful attempts. */
  addresses: string[];
  /** At least one attempt produced addresses. */
  success: boolean;
  attemptCount: number;
  /** Wall time of every attempt, success or not (diagnostic detail). */
  attemptDurationsMs: number[];
}
