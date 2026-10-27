/**
 * OpenTunnel — phase-4 shell. The tunnel client (`createTunnelClient`) is
 * the single tunnel-state authority; the node list and preferences come
 * from the local database; both sheets are presentation modals. No tunnel
 * state is duplicated here: everything rendered descends from a client
 * snapshot or a native event.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { Header, Screen, ThemeProvider } from '@apps-hub/ui';

import { LatencyProber, VpnGateService, type VpnNode } from 'open-tunnel-core';
import { openAppDatabase, type AppDatabase } from './src/data/open-database.ts';
import type { TunnelSettings } from './src/data/settings-store.ts';
import { openTunnelBinding, nativeTcpProbe } from './src/tunnel/native-tcp-probe.ts';
import {
  createTunnelClient,
  OpenTunnelError,
  type TunnelClient,
  type TunnelSnapshot,
} from './src/tunnel/tunnel-client.ts';
import { HomeScreen } from './src/ui/home-screen.tsx';
import { ServerSheet } from './src/ui/server-sheet.tsx';
import { SettingsSheet } from './src/ui/settings-sheet.tsx';

const prober = new LatencyProber(nativeTcpProbe);
/** Render + auto-select pool bound (display-ranking probes stay bounded). */
const LIST_LIMIT = 60;

type SheetKind = 'none' | 'servers' | 'settings';

export default function App() {
  return (
    <ThemeProvider brand="opentunnel">
      <OpenTunnelApp />
    </ThemeProvider>
  );
}

function OpenTunnelApp() {
  const [database, setDatabase] = useState<AppDatabase | null>(null);
  const [settings, setSettings] = useState<TunnelSettings | null>(null);
  const [nodes, setNodes] = useState<readonly VpnNode[]>([]);
  const [activeNode, setActiveNode] = useState<VpnNode | null>(null);
  const [tunnel, setTunnel] = useState<TunnelSnapshot>({
    state: 'disconnected',
    message: null,
    traffic: null,
  });
  const [sheet, setSheet] = useState<SheetKind>('none');
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const busy = tunnel.state === 'connecting' || tunnel.state === 'disconnecting';
  const live = tunnel.state === 'connected' || tunnel.state === 'reasserting' || busy;
  const activeId = activeNode?.id ?? null;

  const clientRef = useRef<TunnelClient | null>(null);
  if (clientRef.current === null) clientRef.current = createTunnelClient(openTunnelBinding);
  const client = clientRef.current;

  // One subscription: the snapshot feeds the screens; native events own
  // cadence. Removed on unmount (plan §4 cleanup rule).
  useEffect(() => {
    mountedRef.current = true;
    const handle = client.subscribe(setTunnel);
    void client.refresh();
    return () => {
      mountedRef.current = false;
      handle.remove();
    };
  }, [client]);

  const refreshList = useCallback(async (opened: AppDatabase) => {
    setRefreshing(true);
    setLoadError(null);
    try {
      await opened.nodes.replaceAllNodes(await new VpnGateService().fetchNodes());
      const best = await opened.nodes.loadNodes({ limit: LIST_LIMIT });
      const ranked = await prober.probeAndScoreNodes(best);
      if (mountedRef.current) setNodes(ranked);
    } catch (error) {
      if (mountedRef.current) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // Cache-first open: settings + last node + cached list, then a fetch when
  // the cache is empty (phase-2 parity).
  useEffect(() => {
    let cancelled = false;
    openAppDatabase()
      .then(async (opened) => {
        if (cancelled) return;
        setDatabase(opened);
        const loaded = await opened.settings.loadSettings();
        if (cancelled) return;
        setSettings(loaded);
        if (loaded.lastNodeId !== null) {
          // Configless label lookup — the payload is only fetched at
          // connect time (plan §5).
          const node = await opened.nodes.getNode(loaded.lastNodeId, { withConfig: false });
          if (!cancelled && node) setActiveNode(node);
        }
        const cached = await opened.nodes.loadNodes({ limit: LIST_LIMIT });
        if (cancelled) return;
        setNodes(cached);
        if (cached.length === 0) await refreshList(opened);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  const connect = useCallback(
    async (node: VpnNode) => {
      if (database === null) {
        setActionError('The local database is still opening. Try again in a moment.');
        return;
      }
      setActionError(null);
      await requestNotifications();
      try {
        // Connect-time payload fetch by node id (list reads are configless).
        const loaded = await database.nodes.getNode(node.id, { withConfig: true });
        if (loaded === null) {
          setActionError('This relay is no longer in the cache. Pull down to refresh the list.');
          return;
        }
        const config = client.configFromNode(loaded, {
          enableKillSwitch: settings?.killSwitchEnabled ?? true,
          disallowedApps: Platform.OS === 'android' ? (settings?.disallowedApps ?? []) : [],
        });
        await database.settings.setLastNodeId(node.id);
        setActiveNode(loaded);
        // Switching relays never double-starts: a live tunnel gets an
        // explicit stop before the new start (plan §5).
        const current = client.getSnapshot();
        if (current.state === 'connected' || current.state === 'reasserting' || current.state === 'connecting') {
          await client.stopTunnel();
        }
        await client.startTunnel(config);
        setSheet('none');
      } catch (error) {
        // Typed pre-start failures (invalid config, payload mismatch) —
        // surfaced verbatim next to the native error surface.
        setActionError(describeLocalError(error));
      }
    },
    [client, database, settings],
  );

  const autoSelect = useCallback(async () => {
    if (busy || nodes.length === 0) {
      if (nodes.length === 0) setActionError('No servers are cached yet. Pull down to load the list.');
      return;
    }
    setActionError(null);
    setScanning(true);
    try {
      // Bounded native probe (concurrency 8) + fitness scoring; socket work
      // happens in the native module, never on the JS thread.
      const ranked = await prober.probeAndScoreNodes(nodes, { concurrency: 8 });
      if (mountedRef.current) setNodes(ranked);
      const winner = ranked[0];
      if (winner) await connect(winner);
    } catch (error) {
      if (mountedRef.current) setActionError(describeLocalError(error));
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, [busy, connect, nodes]);

  const changeKillSwitch = useCallback(
    async (enabled: boolean) => {
      if (database === null) return;
      await database.settings.setKillSwitchEnabled(enabled);
      setSettings((current) =>
        current === null
          ? current
          : { ...current, killSwitchEnabled: enabled },
      );
    },
    [database],
  );

  const addDisallowedApp = useCallback(
    async (packageName: string) => {
      if (database === null) return;
      const current = settings?.disallowedApps ?? [];
      await database.settings.setDisallowedApps([...current, packageName]);
      setSettings((current2) =>
        current2 === null ? current2 : { ...current2, disallowedApps: [...current2.disallowedApps, packageName] },
      );
    },
    [database, settings],
  );

  const removeDisallowedApp = useCallback(
    async (packageName: string) => {
      if (database === null) return;
      const current = settings?.disallowedApps ?? [];
      await database.settings.setDisallowedApps(current.filter((app) => app !== packageName));
      setSettings((current2) =>
        current2 === null
          ? current2
          : { ...current2, disallowedApps: current2.disallowedApps.filter((app) => app !== packageName) },
      );
    },
    [database, settings],
  );

  const openSystemSettings = useCallback(() => {
    void client.openSystemVpnSettings();
  }, [client]);

  const disconnect = useCallback(() => {
    void client.stopTunnel();
  }, [client]);

  return (
    <>
      <Screen scroll refreshing={refreshing} onRefresh={database ? () => void refreshList(database) : undefined}>
        <Header title="OpenTunnel" subtitle="Free VPN Gate relays, no account" />
        <HomeScreen
          tunnel={tunnel}
          activeNode={activeNode}
          nodeCount={nodes.length}
          scanning={scanning}
          loadError={loadError}
          actionError={actionError}
          onConnect={(node) => void connect(node)}
          onAutoSelect={() => void autoSelect()}
          onDisconnect={disconnect}
          onOpenServers={() => setSheet('servers')}
          onOpenSettings={() => setSheet('settings')}
          onOpenSystemSettings={openSystemSettings}
        />
      </Screen>

      <ServerSheet
        visible={sheet === 'servers'}
        onClose={() => setSheet('none')}
        nodes={nodes}
        activeId={activeId}
        live={live}
        tunnel={tunnel}
        busy={busy}
        onConnect={(node) => void connect(node)}
      />

      {settings !== null && (
        <SettingsSheet
          visible={sheet === 'settings'}
          onClose={() => setSheet('none')}
          settings={settings}
          onChangeKillSwitch={(enabled) => void changeKillSwitch(enabled)}
          onAddDisallowedApp={(packageName) => void addDisallowedApp(packageName)}
          onRemoveDisallowedApp={(packageName) => void removeDisallowedApp(packageName)}
          onOpenSystemSettings={() => {
            setSheet('none');
            openSystemSettings();
          }}
        />
      )}
    </>
  );
}

/**
 * Verbatim wording for failures caught before the native call (config
 * build, cache read). Native-side failures flow through the snapshot.
 */
function describeLocalError(error: unknown): string {
  if (error instanceof OpenTunnelError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return `the connect attempt failed (${typeof error})`;
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
