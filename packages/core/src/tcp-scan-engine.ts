/**
 * TcpScanEngine — orchestrates a subnet sweep through the native binding.
 * The binding emits events in real time (mirrors the original KMP
 * `Flow<DiscoveredHost>` design as an event stream); the engine collects
 * them into a typed summary for UI state.
 *
 * HARD RULE forwarded from native: outcome `refused` is a TCP RST ⇒ alive.
 */
import type {
  DiscoveredHost,
  InterfaceInfo,
  ListenerHandle,
  ProbeOutcome,
  ScanCompletePayload,
  ServiceEvent,
  ServiceScanCompletePayload,
} from './model.ts';
import type { NetLensNativeBinding, TcpScanStartParams } from './native-binding.ts';
import { computeSubnetForHost, type SubnetPlan } from './subnet-calculator.ts';

/** Hard OS constraint ports (AGENTS.md rule 7). */
export const DEFAULT_TCP_PORTS: readonly number[] = [80, 443, 22, 445, 5353, 8080, 62078];
/** Hard OS constraint connect timeout per probe. */
export const DEFAULT_TCP_TIMEOUT_MS = 350;
/** Native sweeps re-validate this bound defensively. */
export const NATIVE_HOST_LIMIT = 256;

export class ScanUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanUnavailableError';
  }
}

export interface TcpScanOptions {
  /** Pre-detected host IP; skips binding.detectInterface() when provided. */
  originIp?: string;
  /** Requested CIDR prefix; clamped to /24 by the subnet calculator. */
  requestedPrefix?: number;
  ports?: readonly number[];
  timeoutMs?: number;
}

export interface ScanSummary {
  plan: SubnetPlan;
  hostsFound: number;
  byOutcome: Record<ProbeOutcome, number>;
  durationMs: number | null;
  cancelled: boolean;
  discovered: DiscoveredHost[];
}

export interface ServiceDiscoveryBundle {
  mdns: ServiceEvent[];
  ssdp: ServiceEvent[];
  cancelled: boolean;
}

function emptyByOutcome(): Record<ProbeOutcome, number> {
  return { open: 0, refused: 0, timeout: 0, unreachable: 0 };
}

export class TcpScanEngine {
  private readonly binding: NetLensNativeBinding;

  constructor(binding: NetLensNativeBinding) {
    this.binding = binding;
  }

  /** Real-time hook for UI: fires as soon as a host answers. */
  onHostDiscovered(cb: (host: DiscoveredHost) => void): ListenerHandle {
    return this.binding.addListener('onHostDiscovered', cb);
  }

  /** Real-time hook for mDNS/SSDP enrichment events. */
  onServiceDiscovered(cb: (event: ServiceEvent) => void): ListenerHandle {
    return this.binding.addListener('onServiceDiscovered', cb);
  }

  /**
   * Run one full sweep of the clamped /24 around the active interface host.
   * Resolves with the summary when the native layer emits onScanComplete.
   */
  async scanOnce(options: TcpScanOptions = {}): Promise<ScanSummary> {
    const hostInfo: InterfaceInfo | null = options.originIp
      ? { localIp: options.originIp, cidrPrefix: options.requestedPrefix ?? 24, gatewayIp: null }
      : await this.binding.detectInterface();
    if (!hostInfo) {
      throw new ScanUnavailableError('No active network interface detected');
    }

    const plan = computeSubnetForHost(
      hostInfo.localIp,
      options.requestedPrefix ?? hostInfo.cidrPrefix,
    );
    // Defensive native bound re-assertion (NFR-1 / AGENTS.md rule 7).
    if (plan.hosts.length > NATIVE_HOST_LIMIT) {
      throw new RangeError(
        `Sweep list ${plan.hosts.length} exceeds native bound ${NATIVE_HOST_LIMIT}`,
      );
    }

    const ports = [...(options.ports ?? DEFAULT_TCP_PORTS)];
    const timeoutMs = options.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
    const params: TcpScanStartParams = { hostIps: plan.hosts, ports, timeoutMs };

    const discovered: DiscoveredHost[] = [];
    const byOutcome = emptyByOutcome();
    let completion: ScanCompletePayload | null = null;
    let resolveDone!: (payload: ScanCompletePayload) => void;
    const done = new Promise<ScanCompletePayload>((resolve) => {
      resolveDone = resolve;
    });

    const onHost = (host: DiscoveredHost): void => {
      discovered.push(host);
      byOutcome[host.outcome] = (byOutcome[host.outcome] ?? 0) + 1;
    };
    const onComplete = (payload: ScanCompletePayload): void => {
      completion = payload;
      resolveDone(payload);
    };

    const detach = [
      this.binding.addListener('onHostDiscovered', onHost),
      this.binding.addListener('onScanComplete', onComplete),
    ];

    try {
      await this.binding.startTcpScan(params);
      completion = await done;
      const hostsFound = discovered.filter((h) => h.isReachable).length;
      return {
        plan,
        hostsFound,
        byOutcome,
        durationMs: completion.durationMs,
        cancelled: completion.cancelled,
        discovered,
      };
    } finally {
      for (const handle of detach) handle.remove();
    }
  }

  /**
   * mDNS meta-query + SSDP sweep backed by startServiceDiscovery().
   * Resolves with the collected service events on completion.
   */
  async discoverServices(timeoutMs = 2750): Promise<ServiceDiscoveryBundle> {
    const mdns: ServiceEvent[] = [];
    const ssdp: ServiceEvent[] = [];
    let completion: ServiceScanCompletePayload | null = null;
    let resolveDone!: (payload: ServiceScanCompletePayload) => void;
    const done = new Promise<ServiceScanCompletePayload>((resolve) => {
      resolveDone = resolve;
    });

    const onService = (event: ServiceEvent): void => {
      if (event.kind === 'mdns') mdns.push(event);
      else if (event.kind === 'ssdp') ssdp.push(event);
    };
    const onComplete = (payload: ServiceScanCompletePayload): void => {
      completion = payload;
      resolveDone(payload);
    };

    const detach = [
      this.binding.addListener('onServiceDiscovered', onService),
      this.binding.addListener('onServiceScanComplete', onComplete),
    ];

    try {
      await this.binding.startServiceDiscovery(timeoutMs);
      completion = await done;
      return { mdns, ssdp, cancelled: completion.cancelled };
    } finally {
      for (const handle of detach) handle.remove();
    }
  }

  /** Abort a running sweep natively; still ends with onScanComplete(cancelled). */
  async stop(): Promise<void> {
    await this.binding.stopTcpScan();
  }

  /** Abort a running service discovery natively. */
  async stopServiceDiscovery(): Promise<void> {
    await this.binding.stopServiceDiscovery();
  }
}
