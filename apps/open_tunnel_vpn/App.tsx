/**
 * Phase 1 data-parity screen + Phase 2 dev readout.
 *
 * This screen proves the migrated pipeline end to end on device: VPN Gate
 * fetch → streaming parse → sanitize → SQLite cache → ranked list, and now
 * exposes the phase 2 tunnel contract for development: the native status
 * machine (error = terminal with the native message), the 1 Hz traffic
 * ticks, the system VPN settings deep link, and real TCP probing through
 * the native TcpProbeFn. The full tunnel UI arrives in Phase 4.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  LatencyProber,
  computeFitnessScore,
  nodeLabel,
  VpnGateService,
  type VpnNode,
} from 'open-tunnel-core';
import { openVpnNodeCache } from './src/data/open-database.ts';
import type { VpnNodeCache } from './src/data/node-cache.ts';
import { nativeTcpProbe, openTunnelBinding } from './src/tunnel/native-tcp-probe.ts';
import {
  createTunnelClient,
  type TunnelClient,
  type TunnelSnapshot,
} from './src/tunnel/tunnel-client.ts';

/** Probe bound to the native module's single-connect socket probe. */
const prober = new LatencyProber(nativeTcpProbe);

/** Dev relay-probe budget: the prober's own defaults stay 8 x 1500 ms. */
const PROBE_CANDIDATE_LIMIT = 32;

type RefreshState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; count: number; at: number }
  | { kind: 'error'; message: string };

export default function App() {
  const [cache, setCache] = useState<VpnNodeCache | null>(null);
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [state, setState] = useState<RefreshState>({ kind: 'idle' });
  const [tunnel, setTunnel] = useState<TunnelSnapshot>({
    state: 'disconnected',
    message: null,
    traffic: null,
  });
  const [probeNote, setProbeNote] = useState<string>(PROBE_OFF_NOTE);

  const tunnelClientRef = useRef<TunnelClient | null>(null);
  if (tunnelClientRef.current === null) {
    tunnelClientRef.current = createTunnelClient(openTunnelBinding);
  }
  const tunnelClient = tunnelClientRef.current;

  useEffect(() => {
    const handle = tunnelClient.subscribe(setTunnel);
    void tunnelClient.refresh();
    return () => {
      handle.remove();
    };
  }, [tunnelClient]);

  useEffect(() => {
    let cancelled = false;
    openVpnNodeCache()
      .then(async (opened) => {
        if (cancelled) return;
        setCache(opened);
        // Cached nodes render immediately, before any network round trip.
        setNodes(await opened.loadNodes({ limit: 50 }));
      })
      .catch((error: unknown) =>
        setState({ kind: 'error', message: `cache: ${String(error)}` }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!cache) return;
    setState({ kind: 'loading' });
    try {
      const fetched = await new VpnGateService().fetchNodes();
      // Cache persists the complete fetched list (phase 1 parity);
      // probing upgrades the on-screen ranking for the top candidates.
      await cache.replaceAllNodes(fetched);
      const staticBest = await cache.loadNodes({ limit: PROBE_CANDIDATE_LIMIT });
      const ranked = await prober.probeAndScoreNodes(staticBest);
      const measured = ranked.filter((node) => node.measuredRttMs !== null).length;
      setNodes(ranked);
      setProbeNote(
        measured > 0
          ? `measured ${measured}/${ranked.length} relays (native TCP probe)`
          : `no live measurements; static ping fallback (${ranked.length} relays)`,
      );
      setState({ kind: 'loaded', count: fetched.length, at: Date.now() });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [cache]);

  const startTopRelay = useCallback(async () => {
    const node = nodes[0];
    if (!node) return;
    await requestPostNotificationsNonBlocking();
    // The config payload must come from the cache row itself (list reads
    // blank the sanitized OpenVPN text).
    const fullyLoaded = cache
      ? (await cache.loadNodes({ limit: 1, withConfig: true })).find(
          (candidate) => candidate.id === node.id,
        ) ?? node
      : node;
    await tunnelClient.startTunnel(
      tunnelClient.configFromNode(fullyLoaded, { enableKillSwitch: true }),
    );
  }, [cache, nodes, tunnelClient]);

  const stopTunnel = useCallback(async () => {
    await tunnelClient.stopTunnel();
  }, [tunnelClient]);

  const openSystemVpnSettings = useCallback(async () => {
    await tunnelClient.openSystemVpnSettings();
  }, [tunnelClient]);

  return (
    <ScrollView
      style={styles.sheet}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={state.kind === 'loading'} onRefresh={refresh} />
      }
    >
      <Text style={styles.title}>OpenTunnel</Text>
      <Text style={styles.subtitle}>
        VPN Gate relays · local cache only · no analytics, no accounts
      </Text>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>
          {state.kind === 'idle' && (cache ? 'Pull down to refresh nodes' : 'Opening local cache…')}
          {state.kind === 'loading' && 'Fetching VPN Gate list…'}
          {state.kind === 'loaded' && `Refreshed ${state.count} nodes`}
          {state.kind === 'error' && `Refresh failed: ${state.message}`}
        </Text>
        {state.kind === 'loaded' && <Text style={styles.probeNote}>{probeNote}</Text>}
      </View>

      <View style={styles.tunnelBox}>
        <Text style={styles.tunnelTitle}>Tunnel (dev readout)</Text>
        <Text style={styles.tunnelState}>
          {`state: ${tunnel.state}${tunnel.message ? ` — ${tunnel.message}` : ''}`}
        </Text>
        {tunnel.traffic !== null && (
          <Text style={styles.tunnelMeta}>
            {trafficLine(tunnel.traffic.bytesIn, tunnel.traffic.bytesOut, tunnel.traffic.connectedDurationSec)}
          </Text>
        )}
        <View style={styles.tunnelActions}>
          <DevButton label="Start top relay" onPress={() => void startTopRelay()} />
          <DevButton label="Stop" onPress={() => void stopTunnel()} />
          <DevButton label="System VPN settings" onPress={() => void openSystemVpnSettings()} />
        </View>
      </View>

      {nodes.map((node) => (
        <View key={node.id} style={styles.nodeRow}>
          <Text style={styles.nodeLabel} numberOfLines={1}>
            {nodeLabel(node)}
          </Text>
          <Text style={styles.nodeMeta} numberOfLines={1}>
            {scoreSummary(node)}
          </Text>
        </View>
      ))}

      {nodes.length === 0 && state.kind !== 'loading' && (
        <Text style={styles.empty}>No cached relays yet.</Text>
      )}

      {state.kind === 'loading' && nodes.length === 0 && <ActivityIndicator />}
    </ScrollView>
  );
}

const PROBE_OFF_NOTE = 'no probe yet; static ranking';

/** Static ping for unprobed relays, honest measured RTT once probed. */
function scoreSummary(node: VpnNode): string {
  const fitness = computeFitnessScore(node);
  const parts =
    node.measuredRttMs === null
      ? [`${node.pingMs}ms static`]
      : [`${Math.round(node.measuredRttMs)}ms measured`];
  parts.push(
    `${(node.speedBps / 1000000).toFixed(1)}Mbps`,
    `fitness ${fitness.toFixed(1)}`,
  );
  return parts.join(' · ');
}

function trafficLine(bytesIn: number, bytesOut: number, connectedDurationSec: number): string {
  return `traffic ↓${formatKib(bytesIn)} ↑${formatKib(bytesOut)} · up ${connectedDurationSec}s`;
}

function formatKib(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${bytes}B`;
}

/**
 * POST_NOTIFICATIONS is requested at runtime on Android 13+; a denial
 * never blocks the tunnel (plan §6). Silence on other runtimes.
 */
async function requestPostNotificationsNonBlocking(): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // Denial keeps the tunnel running without the notice.
  }
}

function DevButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tunnelButton} onPress={onPress}>
      <Text style={styles.tunnelButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: '#0b1020' },
  content: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 64 },
  title: { color: '#7dd3fc', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 16 },
  statusBox: {
    backgroundColor: '#111a33',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  statusText: { color: '#cbd5f5', fontSize: 13 },
  probeNote: { color: '#7dd3fc', fontSize: 12, marginTop: 4 },
  tunnelBox: {
    backgroundColor: '#111a33',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  tunnelTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  tunnelState: { color: '#cbd5f5', fontSize: 12, marginTop: 6 },
  tunnelMeta: { color: '#7dd3fc', fontSize: 12, marginTop: 4 },
  tunnelActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tunnelButton: {
    backgroundColor: '#1d2951',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tunnelButtonText: { color: '#7dd3fc', fontSize: 13, fontWeight: '600' },
  nodeRow: {
    backgroundColor: '#111a33',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  nodeLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '600' },
  nodeMeta: { color: '#7dd3fc', fontSize: 12, marginTop: 2 },
  empty: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginTop: 24 },
});
