import type { NetworkInfo, VpnStatusState } from 'open-tunnel-native';

export interface TrustedNetwork {
  ssid: string;
  bssids: string[];
}

// Name and access point must both match: a café can broadcast your home Wi-Fi's name, not its access point.
export function isTrusted(network: NetworkInfo, trusted: readonly TrustedNetwork[]): boolean {
  if (!network.wifi || network.ssid === null || network.bssid === null) return false;
  return trusted.some((entry) => entry.ssid === network.ssid && entry.bssids.includes(network.bssid!));
}

// Shields warns on any network that is not a trusted Wi-Fi, mobile data and unreadable Wi-Fi included; no network is nothing to warn about.
export function untrustedNow(network: NetworkInfo, trusted: readonly TrustedNetwork[]): boolean {
  return network.connected && !isTrusted(network, trusted);
}

export function trustNetwork(network: NetworkInfo, trusted: readonly TrustedNetwork[]): TrustedNetwork[] | null {
  const { ssid, bssid } = network;
  if (!network.wifi || ssid === null || bssid === null) return null;
  const existing = trusted.find((entry) => entry.ssid === ssid);
  if (existing === undefined) return [...trusted, { ssid, bssids: [bssid] }];
  if (existing.bssids.includes(bssid)) return [...trusted];
  return trusted.map((entry) => (entry === existing ? { ssid, bssids: [...entry.bssids, bssid] } : entry));
}

export function forgetNetwork(ssid: string, trusted: readonly TrustedNetwork[]): TrustedNetwork[] {
  return trusted.filter((entry) => entry.ssid !== ssid);
}

export function parseTrustedNetworks(raw: unknown): TrustedNetwork[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): TrustedNetwork[] => {
    if (entry === null || typeof entry !== 'object') return [];
    const { ssid, bssids } = entry as Record<string, unknown>;
    if (typeof ssid !== 'string' || ssid.length === 0 || !Array.isArray(bssids)) return [];
    const kept = bssids.filter((bssid): bssid is string => typeof bssid === 'string' && bssid.length > 0);
    return kept.length === 0 ? [] : [{ ssid, bssids: kept }];
  });
}

function networkKey(network: NetworkInfo): string | null {
  if (!network.connected) return null;
  if (!network.wifi) return 'mobile';
  return `wifi:${network.ssid ?? '?'}:${network.bssid ?? '?'}`;
}

export interface AutoConnectInput {
  enabled: boolean;
  network: NetworkInfo;
  trusted: readonly TrustedNetwork[];
  tunnelState: VpnStatusState;
  scanning: boolean;
}

// Decides once per network: a disconnect the user makes on that network is not undone until the network changes.
export function autoConnectDecision(previousKey: string | null, input: AutoConnectInput): { key: string | null; connect: boolean } {
  const key = networkKey(input.network);
  if (key === null || key === previousKey) return { key, connect: false };
  const idle = input.tunnelState === 'disconnected' || input.tunnelState === 'error';
  return { key, connect: input.enabled && idle && !input.scanning && !isTrusted(input.network, input.trusted) };
}

export function describeNetwork(network: NetworkInfo | null, trusted: readonly TrustedNetwork[]): string {
  if (network === null) return 'Checking the network';
  if (!network.connected) return 'No network';
  if (!network.wifi) return 'Mobile data, not trusted';
  if (network.ssid === null || network.bssid === null) {
    return 'Wi-Fi with a hidden name. Turn on Location and allow precise location for TunnelWall.';
  }
  return isTrusted(network, trusted) ? `${network.ssid}, trusted` : `${network.ssid}, not trusted`;
}
