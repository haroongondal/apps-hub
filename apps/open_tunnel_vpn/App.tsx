/**
 * OpenTunnel — phase-4 shell. The tunnel client (`createTunnelClient`) is
 * the single tunnel-state authority; the node list and preferences come
 * from the local database; both sheets are presentation modals. No tunnel
 * state is duplicated here: everything rendered descends from a client
 * snapshot or a native event.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, View } from 'react-native';
import { Header, Screen, TabBar, ThemeProvider } from '@apps-hub/ui';

import { LatencyProber, VpnGateService, type VpnNode } from 'open-tunnel-core';
import { openAppDatabase, type AppDatabase } from './src/data/open-database.ts';
import type { TunnelSettings } from './src/data/settings-store.ts';
import { xhrVpnGateFetcher } from './src/data/vpngate-fetcher.ts';
import { FirewallScreen } from './src/firewall/firewall-screen.tsx';
import { serverHoldsSlot } from './src/firewall/status.ts';
import { firewallBinding, openTunnelBinding, nativeTcpProbe } from './src/tunnel/native-tcp-probe.ts';
import { MAX_ATTEMPTS, isAuthError, pickRelayCandidates } from './src/tunnel/relay-failover.ts';
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
import { TunnelShield } from './src/ui/tunnel-shield.tsx';

const prober = new LatencyProber(nativeTcpProbe);
// VPN Gate relays come and go within hours, so a cache older than this is
// refetched on open; a fresher cache shows as-is and manual refresh
// (pull-to-refresh, the Refresh button) stays available.
const AUTO_REFRESH_AFTER_MS = 60 * 60 * 1000;

type SheetKind = 'none' | 'servers' | 'settings';

const FIREWALL_TAB = Platform.OS === 'android';
const TABS = [
  { key: 'home', label: 'Connection' },
  { key: 'firewall', label: 'Firewall' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
// The firewall notification opens this link (FirewallService.FIREWALL_LINK).
const FIREWALL_LINK = 'opentunnel://firewall';

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
    code: null,
    traffic: null,
  });
  const [sheet, setSheet] = useState<SheetKind>('none');
  const [tab, setTab] = useState<TabKey>('home');
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

  useEffect(() => {
    if (!FIREWALL_TAB) return;
    const open = (url: string | null) => {
      if (url === FIREWALL_LINK) setTab('firewall');
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => subscription.remove();
  }, []);

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

  // Auto-refresh only a stale cache: VPN Gate relays come and go within
  // hours, so the app refetches when the cache is an hour old or more,
  // while a fresh one shows as-is. The cached list still renders first,
  // before any refetch, and pull-to-refresh plus the Refresh button stay
  // manual.
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
        const lastFetchedAt = await opened.nodes.lastFetchedAtMs();
        if (cancelled) return;
        // An empty cache has never been fetched (stamp null), so it counts as stale.
        if (lastFetchedAt === null || Date.now() - lastFetchedAt >= AUTO_REFRESH_AFTER_MS) {
          await refreshList(opened);
        }
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
        let resolved = await database.nodes.getNode(node.id, { withConfig: true });
        if (resolved === null) {
          // A picked relay can vanish between listing and connecting (VPN
          // Gate churns within hours): refresh the list once, then re-read.
          setActionError('This relay is no longer in the cache. Refreshing the relay list.');
          await refreshList(database);
          resolved = await database.nodes.getNode(node.id, { withConfig: true });
          if (resolved === null) {
            // Exactly one retry — no loops; a still-missing relay is gone.
            setActionError('This relay is gone from the refreshed list. Pick another server.');
            return;
          }
          // The recovery succeeded, so the in-progress wording must not linger.
          setActionError(null);
        }
        const config = client.configFromNode(resolved, {
          enableKillSwitch: settings?.killSwitchEnabled ?? true,
          disallowedApps: Platform.OS === 'android' ? (settings?.disallowedApps ?? []) : [],
        });
        await database.settings.setLastNodeId(node.id);
        setActiveNode(resolved);
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
    [client, database, settings, refreshList],
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
      let candidates = pickRelayCandidates(ranked, failedIds.current, MAX_ATTEMPTS);
      // When every candidate already failed, a stale cache is the likely
      // cause (relays churn within hours): refresh the list once and
      // re-rank before giving up. `retriedCache` keeps this a single retry,
      // never a loop.
      let retriedCache = false;
      if (candidates.length === 0 && !retriedCache && database !== null) {
        const lastFetchedAt = await database.nodes.lastFetchedAtMs();
        if (lastFetchedAt !== null && Date.now() - lastFetchedAt >= AUTO_REFRESH_AFTER_MS) {
          retriedCache = true;
          const refreshed = await refreshList(database);
          if (refreshed !== null) {
            const reRanked = inCountry(refreshed);
            const reRankedIds = new Set(reRanked.map((node) => node.id));
            if (mountedRef.current) {
              setNodes((all) => [...reRanked, ...all.filter((node) => !reRankedIds.has(node.id))]);
            }
            candidates = pickRelayCandidates(reRanked, failedIds.current, MAX_ATTEMPTS);
          }
        }
      }
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
    // A tunnel that was up and dropped moves to the best relay of a fresh
    // list; an auth rejection fails over even on a first connect — the
    // relay refused this client, so retrying it cannot succeed. Failed
    // relays stay benched across refreshes so a just-failed relay is never
    // retried in a loop.
    const auth = tunnel.code !== null && isAuthError(tunnel.code);
    if (was === 'connected' || was === 'reasserting' || auth) void autoSelect(true);
  }, [tunnel.state, tunnel.code, activeNode, autoSelect]);

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

  const confirmFirewallConsent = useCallback(async () => {
    if (database === null) return;
    try {
      await database.settings.setFirewallConsented();
      setSettings((current) => (current === null ? current : { ...current, firewallConsented: true }));
    } catch {
      // The flag stays unset, so the sheet shows again on the next turn-on.
    }
  }, [database]);

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
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: tab === 'home' ? 'flex' : 'none' }}>
        <Screen scroll refreshing={refreshing} onRefresh={database ? () => void refreshList(database) : undefined}>
          <Header title="TunnelWall" subtitle="Free VPN Gate relays, no account" />
          <HomeScreen
            tunnel={tunnel}
            activeNode={activeNode}
            nodeCount={shown.length}
            countries={countryOptions(nodes)}
            country={country}
            onSelectCountry={selectCountry}
            refreshing={refreshing}
            onRefreshList={() => {
              if (database !== null) void refreshList(database);
            }}
            loadError={loadError}
            actionError={actionError}
            onAutoSelect={() => void autoSelect()}
            onOpenServers={() => setSheet('servers')}
            onOpenSettings={() => setSheet('settings')}
            onOpenSystemSettings={openSystemSettings}
          />
        </Screen>
        <TunnelShield
          tunnel={tunnel}
          activeNode={activeNode}
          scanning={scanning}
          onConnect={(node) => void connect(node)}
          onAutoSelect={() => void autoSelect()}
          onDisconnect={disconnect}
        />
      </View>

      {FIREWALL_TAB && tab === 'firewall' && (
        <View style={{ flex: 1 }}>
          <FirewallScreen
            api={firewallBinding}
            serverConnected={serverHoldsSlot(tunnel.state)}
            consented={settings?.firewallConsented ?? false}
            onConsent={() => void confirmFirewallConsent()}
          />
        </View>
      )}
      {FIREWALL_TAB && <TabBar tabs={TABS} value={tab} onChange={setTab} />}

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
    </View>
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
