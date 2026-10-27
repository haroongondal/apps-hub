import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  Button,
  Dot,
  Empty,
  Group,
  Header,
  Notice,
  Pill,
  Row,
  Screen,
  Text,
  ThemeProvider,
  type Tone,
} from '@apps-hub/ui';

import { LatencyProber, VpnGateService, type VpnNode } from 'open-tunnel-core';
import { openVpnNodeCache } from './src/data/open-database.ts';
import type { VpnNodeCache } from './src/data/node-cache.ts';
import { nativeTcpProbe, openTunnelBinding } from './src/tunnel/native-tcp-probe.ts';
import {
  createTunnelClient,
  type TunnelClient,
  type TunnelSnapshot,
} from './src/tunnel/tunnel-client.ts';

const prober = new LatencyProber(nativeTcpProbe);
const LIST_LIMIT = 40;

export default function App() {
  return (
    <ThemeProvider brand="opentunnel">
      <Servers />
    </ThemeProvider>
  );
}

function Servers() {
  const [cache, setCache] = useState<VpnNodeCache | null>(null);
  const [nodes, setNodes] = useState<VpnNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState<TunnelSnapshot>({ state: 'disconnected', message: null, traffic: null });

  const clientRef = useRef<TunnelClient | null>(null);
  if (clientRef.current === null) clientRef.current = createTunnelClient(openTunnelBinding);
  const client = clientRef.current;

  useEffect(() => {
    const handle = client.subscribe(setTunnel);
    void client.refresh();
    return () => handle.remove();
  }, [client]);

  const refresh = useCallback(async (opened: VpnNodeCache) => {
    setLoading(true);
    setLoadError(null);
    try {
      await opened.replaceAllNodes(await new VpnGateService().fetchNodes());
      const best = await opened.loadNodes({ limit: LIST_LIMIT, withConfig: true });
      setNodes(await prober.probeAndScoreNodes(best));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    openVpnNodeCache()
      .then(async (opened) => {
        if (cancelled) return;
        setCache(opened);
        const cached = await opened.loadNodes({ limit: LIST_LIMIT, withConfig: true });
        setNodes(cached);
        if (cached.length === 0) await refresh(opened);
      })
      .catch((error: unknown) => setLoadError(String(error)));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const connect = useCallback(
    async (node: VpnNode) => {
      await requestNotifications();
      setActiveId(node.id);
      await client.startTunnel(client.configFromNode(node, { enableKillSwitch: true }));
    },
    [client],
  );

  const busy = tunnel.state === 'connecting' || tunnel.state === 'disconnecting';
  const live = tunnel.state === 'connected' || tunnel.state === 'reasserting' || busy;
  const active = nodes.find((node) => node.id === activeId) ?? null;

  return (
    <Screen scroll refreshing={loading} onRefresh={cache ? () => void refresh(cache) : undefined}>
      <Header title="OpenTunnel" subtitle="Free VPN Gate servers, no account" />

      <Group title="Connection">
        <Row
          leading={<Dot tone={STATE_TONE[tunnel.state]} />}
          title={stateTitle(tunnel, active)}
          subtitle={live && tunnel.traffic ? trafficLine(tunnel.traffic) : undefined}
          trailing={
            live ? (
              <Button label="Disconnect" variant="secondary" size="sm" busy={tunnel.state === 'disconnecting'} onPress={() => void client.stopTunnel()} />
            ) : undefined
          }
        />
      </Group>

      {tunnel.state === 'error' && tunnel.message && (
        <Notice tone="danger" title="Couldn't connect">
          {tunnel.message.replace(/^ERR_[A-Z_]+: /, '')}
        </Notice>
      )}
      {loadError && (
        <Notice tone="warn" title="Couldn't load the server list">
          {`${loadError}. Pull down to try again.`}
        </Notice>
      )}

      {nodes.length === 0 ? (
        <Empty
          title={loading ? 'Loading servers' : 'No servers yet'}
          body={loading ? 'Fetching the VPN Gate list. This can take a minute.' : 'Pull down to load the VPN Gate list.'}
        />
      ) : (
        <Group
          title="Servers"
          footer="Volunteers run these servers and can see which sites you visit. Use HTTPS sites."
        >
          {nodes.map((node) => (
            <Row
              key={node.id}
              title={`${countryName(node)} · ${node.hostName}`}
              subtitle={serverLine(node)}
              trailing={node.id === activeId && live ? <Pill label={tunnel.state === 'connected' ? 'Connected' : 'Connecting'} tone="ok" /> : undefined}
              onPress={busy ? undefined : () => void connect(node)}
              accessibilityHint="Connects to this server"
            />
          ))}
        </Group>
      )}

      <Button label="Always-on VPN settings" variant="ghost" onPress={() => void client.openSystemVpnSettings()} />
      <Text variant="caption" tone="faint" align="center">
        OpenTunnel is free software under the GPLv2. Source: github.com/haroongondal/apps-hub
      </Text>
    </Screen>
  );
}

const STATE_TONE: Record<TunnelSnapshot['state'], Tone> = {
  disconnected: 'neutral',
  connecting: 'warn',
  connected: 'ok',
  reasserting: 'warn',
  disconnecting: 'warn',
  error: 'danger',
};

function stateTitle(tunnel: TunnelSnapshot, active: VpnNode | null): string {
  const where = active ? ` to ${countryName(active)}` : '';
  switch (tunnel.state) {
    case 'connected':
      return `Connected${where}`;
    case 'connecting':
      return `Connecting${where}`;
    case 'reasserting':
      return `Reconnecting${where}`;
    case 'disconnecting':
      return 'Disconnecting';
    default:
      return 'Not connected. Tap a server to connect.';
  }
}

function countryName(node: VpnNode): string {
  return node.countryLong || node.countryShort;
}

function serverLine(node: VpnNode): string {
  const ping = node.measuredRttMs === null ? node.pingMs : Math.round(node.measuredRttMs);
  return `${ping} ms · ${(node.speedBps / 1_000_000).toFixed(0)} Mbps · ${node.transportProto.toUpperCase()}`;
}

// Native ticks carry bytes moved in the last second, not running totals.
function trafficLine(traffic: NonNullable<TunnelSnapshot['traffic']>): string {
  return `Down ${formatBytes(traffic.bytesIn)}/s · Up ${formatBytes(traffic.bytesOut)}/s · ${formatDuration(traffic.connectedDurationSec)}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m > 0 ? `${m} min` : `${seconds} s`;
}

// A denial only hides the connection notice; the tunnel still runs.
async function requestNotifications(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return;
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    // ignored: see above
  }
}
