/**
 * Phase 1 data-parity screen.
 *
 * The full tunnel UI arrives in Phase 4; this screen proves the migrated
 * pipeline end to end on device: VPN Gate fetch → streaming parse →
 * sanitize → SQLite cache → ranked list. Latency probing is intentionally
 * not wired here — raw TCP probing needs the native module (Phase 2), so
 * scores use the upstream static ping as fitness input until then.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  computeFitnessScore,
  nodeLabel,
  VpnGateService,
  type VpnNode,
} from 'open-tunnel-core';
import { openVpnNodeCache } from './src/data/open-database.ts';
import type { VpnNodeCache } from './src/data/node-cache.ts';

type RefreshState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; count: number; at: number }
  | { kind: 'error'; message: string };

export default function App() {
  const [cache, setCache] = useState<VpnNodeCache | null>(null);
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [state, setState] = useState<RefreshState>({ kind: 'idle' });

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
      await cache.replaceAllNodes(fetched);
      const ranked = await cache.loadNodes({ limit: 50 });
      setNodes(ranked);
      setState({ kind: 'loaded', count: fetched.length, at: Date.now() });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [cache]);

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
      </View>

      {nodes.map((node) => (
        <View key={node.id} style={styles.nodeRow}>
          <Text style={styles.nodeLabel} numberOfLines={1}>
            {nodeLabel(node)}
          </Text>
          <Text style={styles.nodeMeta} numberOfLines={1}>
            {staticScoreSummary(node)}
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

/** Until the native TCP probe lands (Phase 2), fitness input is the upstream
 * static ping; label states that honestly instead of implying measurement. */
function staticScoreSummary(node: VpnNode): string {
  const fitness = computeFitnessScore(node);
  const parts = [
    `${node.pingMs}ms static`,
    `${(node.speedBps / 1000000).toFixed(1)}Mbps`,
    `fitness ${fitness.toFixed(1)}`,
  ];
  return parts.join(' · ');
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
