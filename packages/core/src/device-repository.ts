/**
 * DeviceRepository — FR-4 local persistence + "new device" identification
 * (SPEC §4, Phase 3). Pure TypeScript with an injectable `DeviceStore` port
 * so the SQL schema lives in the app layer while the reconciliation rules
 * run under node --test with a fake store.
 *
 * Identity contract (AC-3): a device is matched by its
 *   identityKey = mDNS instance/hostname — or, when organically exposed,
 *   SSDP USN — falling back to the current IP.
 * Practical note: the native sweep reports mDNS service *types*
 * (network-wide) and SSDP USN for responding devices, so real identitys are
 * `usn:` (stable across IP changes) and `ip:` (per-host fallback).
 *
 * Reconciliation across a scan:
 *   - alive hosts (open OR refused/RST — hard rule #2) become devices;
 *     dead probes never create rows,
 *   - a row whose identityKey was never stored for this network is flagged
 *     isNew = true (AC-2, drives the UI "NEW" badge),
 *   - custom_name and is_trusted are never overwritten by a scan (AC-3),
 *   - devices not answering in the current sweep remain stored (history)
 *     and are reported with seenThisScan = false.
 */
import type { DiscoveredHost, ProbeOutcome } from './model.ts';

export interface StoredNetwork {
  /** hashNetworkId(gatewayIp, cidr) — SPEC §4 `network_id`. */
  networkId: string;
  gatewayIp: string;
  subnetCidr: string;
  customName: string | null;
  lastScannedAt: number;
}

export interface StoredDevice {
  /** Autoincrement row id; null before the first insert. */
  id: number | null;
  networkId: string;
  identityKey: string;
  lastIp: string;
  hostname: string | null;
  customName: string | null;
  vendorOrModel: string | null;
  openPortsCsv: string;
  mdnsServicesCsv: string;
  isTrusted: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Names learned after the sweep (see device-names.ts); null until found. */
  mdnsName: string | null;
  friendlyName: string | null;
  model: string | null;
  netbiosName: string | null;
}

export interface DeviceStore {
  upsertNetwork(network: StoredNetwork): Promise<void>;
  listDevices(networkId: string): Promise<StoredDevice[]>;
  /** Insert a brand-new device row; resolves with its generated row id. */
  insertDevice(device: StoredDevice): Promise<number>;
  /** Full-row update (id required); callers compose from the existing row. */
  updateDevice(device: StoredDevice): Promise<void>;
}

/**
 * Per-host enrichment correlated from mDNS/SSDP events, keyed by the source
 * IP of the SSDP unicast response (mDNS meta-query types are network-wide,
 * so they cannot enrich a single host).
 */
export interface HostEnrichment {
  /** SSDP USN — the most stable per-physical-device identifier. */
  usn?: string | null;
  /** SSDP SERVER header (or the LOCATION host as a display fallback). */
  vendorOrModel?: string | null;
  /** Hostname when one was organically learned; null otherwise. */
  hostname?: string | null;
}

/** The open_ports CSV carries the winning probe port (native reports one). */
export function openPortsCsvFor(host: DiscoveredHost): string {
  return host.winningPort === null ? '' : String(host.winningPort);
}

/** FNV-1a 32-bit over `gatewayIp/prefix`; deterministic across processes. */
export function hashNetworkId(gatewayIp: string, cidrPrefix: number): string {
  const input = `${gatewayIp}/${cidrPrefix}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `net_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Identity precedence: USN (stable across IP changes) → hostname → IP.
 * Keys are prefixed and lower-cased so they cannot collide across kinds.
 */
export function deriveIdentityKey(
  ip: string,
  enrichment: HostEnrichment | undefined,
): string {
  const usn = enrichment?.usn?.trim();
  if (usn) return `usn:${usn.toLowerCase()}`;
  const hostname = enrichment?.hostname?.trim();
  if (hostname) return `host:${hostname.toLowerCase()}`;
  return `ip:${ip}`;
}

export interface ScanReconciliation {
  /** Pre-computed via hashNetworkId; gatewayIp may be null on NFR-3 paths. */
  networkId: string;
  gatewayIp: string | null;
  /** Detection result as text, e.g. "192.168.7.0/24". */
  subnetCidr: string;
  /** Alive sweep results, in discovery order. */
  hosts: readonly DiscoveredHost[];
  /** Enrichment keyed by host IP; missing entries fall back to `ip:` keys. */
  enrichmentByIp: Readonly<Record<string, HostEnrichment>>;
}

export interface ReconciledDevice extends StoredDevice {
  /** Stored for the first time by THIS scan (AC-2 "NEW" badge). */
  isNew: boolean;
  /** Answered in the current sweep. */
  seenThisScan: boolean;
}

export interface ReconcileResult {
  networkId: string;
  scannedAt: number;
  /** Every stored row for the network after the merge. */
  devices: ReconciledDevice[];
  newCount: number;
  knownCount: number;
}

/** Outcome criterion for turning a probe into a stored device. */
export function isDeviceWorthy(outcome: ProbeOutcome): boolean {
  return outcome === 'open' || outcome === 'refused';
}

function enrichedRow(
  existing: StoredDevice,
  ip: string,
  enrichment: HostEnrichment | undefined,
  host: DiscoveredHost,
  now: number,
): StoredDevice {
  const hostname = enrichment?.hostname?.trim() ?? null;
  const vendorOrModel = enrichment?.vendorOrModel?.trim() ?? null;
  return {
    ...existing,
    // Custom name and trust are scan-immutable (AC-3) — never reassigned.
    lastIp: ip,
    hostname: hostname ?? existing.hostname,
    vendorOrModel: vendorOrModel ?? existing.vendorOrModel,
    openPortsCsv: openPortsCsvFor(host),
    lastSeenAt: now,
  };
}

/**
 * Merge one sweep into the store. Alive hosts are matched by identityKey;
 * matched rows are updated (custom/trust preserved) and new identityKeys are
 * inserted with isNew = true. Storage failures propagate so callers can
 * surface them instead of silently losing history.
 */
export async function reconcileScan(
  scan: ScanReconciliation,
  store: DeviceStore,
  now: number = Date.now(),
): Promise<ReconcileResult> {
  await store.upsertNetwork({
    networkId: scan.networkId,
    gatewayIp: scan.gatewayIp ?? '',
    subnetCidr: scan.subnetCidr,
    customName: null,
    lastScannedAt: now,
  });

  const loaded = await store.listDevices(scan.networkId);
  const byKey = new Map<string, StoredDevice>(
    loaded.map((device) => [device.identityKey, device]),
  );
  // Keyed by identityKey, not object identity: scan updates replace the
  // seeded copies wholesale instead of co-existing as duplicate entries.
  const results = new Map<string, ReconciledDevice>();
  for (const device of loaded) {
    results.set(device.identityKey, {
      ...device,
      isNew: false,
      seenThisScan: false,
    });
  }

  let newCount = 0;
  let knownCount = 0;
  const seen = new Set<string>();

  for (const host of scan.hosts) {
    if (!host.isReachable || !isDeviceWorthy(host.outcome)) continue;
    const enrichment = scan.enrichmentByIp[host.ip];
    const identityKey = deriveIdentityKey(host.ip, enrichment);
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);

    const existing = byKey.get(identityKey);
    if (existing) {
      const updated = enrichedRow(existing, host.ip, enrichment, host, now);
      await store.updateDevice(updated);
      knownCount += 1;
      results.set(updated.identityKey, {
        ...updated,
        isNew: false,
        seenThisScan: true,
      });
      continue;
    }

    const anchor: Omit<StoredDevice, 'id'> & { id: number | null } = {
      id: null,
      networkId: scan.networkId,
      identityKey,
      lastIp: host.ip,
      hostname: enrichment?.hostname?.trim() ?? null,
      customName: null,
      vendorOrModel: enrichment?.vendorOrModel?.trim() ?? null,
      openPortsCsv: openPortsCsvFor(host),
      // mDNS meta-query reports service TYPES network-wide, never per host,
      // so the CSV stays empty here; the UI renders types separately.
      mdnsServicesCsv: '',
      isTrusted: false,
      firstSeenAt: now,
      lastSeenAt: now,
      mdnsName: null,
      friendlyName: null,
      model: null,
      netbiosName: null,
    };
    const id = await store.insertDevice(anchor as StoredDevice);
    const inserted: StoredDevice = { ...anchor, id };
    byKey.set(identityKey, inserted);
    newCount += 1;
    results.set(inserted.identityKey, {
      ...inserted,
      isNew: true,
      seenThisScan: true,
    });
  }

  return {
    networkId: scan.networkId,
    scannedAt: now,
    devices: [...results.values()],
    newCount,
    knownCount,
  };
}
