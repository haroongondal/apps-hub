/**
 * Injectable contract implemented by the `netlens-core` Expo module
 * (src/index.ts adapter) and faked in unit tests. Keeping this port pure TS
 * lets the engine run under Jest-equivalent node --test with a fake native
 * module and under Metro with the real one.
 */
import type {
  DnsResolution,
  InterfaceInfo,
  ListenerHandle,
  ScanEventName,
  ScanEventListener,
  TcpHandshakeResult,
} from './model.ts';

export interface TcpScanStartParams {
  hostIps: readonly string[];
  ports: readonly number[];
  timeoutMs: number;
}

export interface NetLensNativeBinding {
  detectInterface(): Promise<InterfaceInfo | null>;
  addListener<E extends ScanEventName>(
    event: E,
    listener: ScanEventListener<E>,
  ): ListenerHandle;
  startTcpScan(params: TcpScanStartParams): Promise<void>;
  stopTcpScan(): Promise<void>;
  startServiceDiscovery(timeoutMs: number): Promise<void>;
  stopServiceDiscovery(): Promise<void>;
  /**
   * SPEC §5 / Phase 2: single TCP handshake around (ip, port).
   * HARD RULE: the RTT is valid for BOTH an `open` connect and a `refused`
   * reply (TCP RST carrier); `timeout` / `unreachable` carry rttMs = null.
   */
  measureTcpHandshake(
    ip: string,
    port: number,
    timeoutMs: number,
  ): Promise<TcpHandshakeResult>;
  /**
   * SPEC §5 / Phase 2: one OS resolver round-trip via the native bridge
   * (Android `InetAddress` / iOS `getaddrinfo`). Null only when the bridge
   * itself is unavailable; failed lookups resolve with `success: false`.
   */
  resolveHostname(hostname: string): Promise<DnsResolution | null>;
}
