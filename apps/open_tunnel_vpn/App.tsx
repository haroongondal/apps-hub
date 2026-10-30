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
import { xhrVpnGateFetcher } from './src/data/vpngate-fetcher.ts';
import { openTunnelBinding, nativeTcpProbe } from './src/tunnel/native-tcp-probe.ts';
import {
  createTunnelClient,
  OpenTunnelError,
  settled,
  type TunnelClient,
  type TunnelSnapshot,
} from './src/tunnel/tunnel-client.ts';
import { countryCode, countryOptions } from './src/ui/format.ts';
import { HomeScreen } from './src/ui/home-screen.tsx';
import { ServerSheet } from './src/ui/server-sheet.tsx';
import { SettingsSheet } from './src/ui/settings-sheet.tsx';

const prober = new LatencyProber(nativeTcpProbe);
const MAX_ATTEMPTS = 3;

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
  const [country, setCountry] = useState<string | null>(null);
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
  const failedIds = useRef(new Set<string>());

  const busy = tunnel.state === 'connecting' || tunnel.state === 'disconnecting';
  const live = tunnel.state === 'connected' || tunnel.state === 'reasserting' || busy;
  const activeId = activeNode?.id ?? null;
  const inCountry = (list: readonly VpnNode[]) =>
    country === null ? list : list.filter((node) => countryCode(node) === country);
  const shown = inCountry(nodes);

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

  const refreshList = useCallback(async (opened: AppDatabase): Promise<readonly VpnNode[] | null> => {
    setRefreshing(true);
    setLoadError(null);
    try {
      await opened.nodes.replaceAllNodes(
        await new VpnGateService({ fetcher: xhrVpnGateFetcher() }).fetchNodes(),
      );
      // The cache holds one VPN Gate fetch (~100 relays); all of them load so every country is offered.
      const ranked = await prober.probeAndScoreNodes(await opened.nodes.loadNodes());
      if (mountedRef.current) setNodes(ranked);
      return ranked;
    } catch (error) {
      if (mountedRef.current) {
        setLoadError(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // Always refetch after showing the cache: VPN Gate relays come and go within hours.
  useEffect(() => {
    let cancelled = false;
    openAppDatabase()
      .then(async (opened) => {
        if (cancelled) return;
        setDatabase(opened);
        const loaded = await opened.settings.loadSettings();
        if (cancelled) return;
        setSettings(loaded);
        const { state } = await client.refresh();
        // Only a still-running tunnel gets its label back; an idle one would make the button retry an old, likely gone relay.
        if (loaded.lastNodeId !== null && state !== 'disconnected' && state !== 'error') {
          // Configless label lookup — the payload is only fetched at
          // connect time (plan §5).
          const node = await opened.nodes.getNode(loaded.lastNodeId, { withConfig: false });
          if (!cancelled && node) setActiveNode(node);
        }
        const cached = await opened.nodes.loadNodes();
        if (cancelled) return;
        setNodes(cached);
        await refreshList(opened);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [client, refreshList]);

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

  const autoSelect = useCallback(async (refetch = false) => {
    if (busy || scanning || shown.length === 0) {
      if (shown.length === 0) setActionError('No servers are cached yet. Pull down to load the list.');
      return;
    }
    setActionError(null);
    setScanning(true);
    try {
      // A refetched list comes back probed and ranked; a failed refetch falls back to the cache.
      const refetched = refetch && database !== null ? await refreshList(database) : null;
      // Bounded native probe (concurrency 8) + fitness scoring; socket work
      // happens in the native module, never on the JS thread.
      const ranked = refetched !== null ? inCountry(refetched) : await prober.probeAndScoreNodes(shown, { concurrency: 8 });
      const rankedIds = new Set(ranked.map((node) => node.id));
      if (mountedRef.current) setNodes((all) => [...ranked, ...all.filter((node) => !rankedIds.has(node.id))]);
      // VPN Gate lists relays that are down or refuse this client, so a failed start moves on to the next one.
      const candidates = ranked.filter((node) => !failedIds.current.has(node.id)).slice(0, MAX_ATTEMPTS);
      if (candidates.length === 0) {
        setActionError('Every relay here has already failed. Pull down to refresh the list, or choose another country.');
      }
      for (const candidate of candidates) {
        await connect(candidate);
        if ((await settled(client)) !== 'error') return;
      }
    } catch (error) {
      if (mountedRef.current) setActionError(describeLocalError(error));
    } finally {
      if (mountedRef.current) setScanning(false);
    }
  }, [busy, scanning, connect, shown, client, database, refreshList, inCountry]);

  const lastState = useRef(tunnel.state);
  useEffect(() => {
    const was = lastState.current;
    lastState.current = tunnel.state;
    if (tunnel.state !== 'error' || was === 'error') return;
    // Auto-select skips relays that already failed this session, whoever picked them.
    if (activeNode !== null) failedIds.current.add(activeNode.id);
    // A tunnel that was up and dropped (relay or auth error) moves to the best relay of a fresh list.
    if (was === 'connected' || was === 'reasserting') void autoSelect(true);
  }, [tunnel.state, activeNode, autoSelect]);

  const selectCountry = useCallback(
    (code: string | null) => {
      setCountry(code);
      // The connect button retries the last relay; it must not jump back to another country.
      if (!live && code !== null && activeNode !== null && countryCode(activeNode) !== code) setActiveNode(null);
    },
    [live, activeNode],
  );

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
        <Header title="TunnelWall" subtitle="Free VPN Gate relays, no account" />
        <HomeScreen
          tunnel={tunnel}
          activeNode={activeNode}
          nodeCount={shown.length}
          countries={countryOptions(nodes)}
          country={country}
          onSelectCountry={selectCountry}
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
        nodes={shown}
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
