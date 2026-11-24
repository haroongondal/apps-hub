// Background checks run natively without JS, so after each scan on the home network the device list
// is handed to native, debounced (name lookups change the rows several times per scan).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  DEFAULT_HOME_WATCH_SETTINGS,
  MAX_SWEEP_PREFIX,
  hashNetworkId,
  homeWatchSnapshot,
  orderHomeWatch,
  postScanSyncHome,
  readHomeRouter,
  type HomeWatchSettings,
  type HomeWatchStatus,
  type InterfaceInfo,
  type NetLensNativeBinding,
  type ReconciledDevice,
} from '@apps-hub/core';
import { createHomeWatchBinding } from 'netlens-core';

const SYNC_DELAY_MS = 2000;
const NO_ROUTER_ID =
  "Your router doesn't tell HomeNet its ID, so HomeNet can't tell your home Wi-Fi from another one that uses the same router address. " +
  "Turn on UPnP in your router's settings, run a check, then try again.";

export interface HomeWatch {
  status: HomeWatchStatus | null;
  notificationsAllowed: boolean;
  updateHomeWatch(patch: Partial<Omit<HomeWatchSettings, 'home'>>): Promise<string | null>;
  markDeviceMine(ip: string): Promise<void>;
}

async function notificationsGranted(ask: boolean): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return true;
  if (!ask) return false;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export function useHomeWatch(
  devices: readonly ReconciledDevice[],
  currentNetworkId: string | null,
  iface: InterfaceInfo | null,
  networkName: string | null,
  scanDone: boolean,
  net: Pick<NetLensNativeBinding, 'tcpFetch'>,
  locationsByIp: ReadonlyMap<string, string[]>,
): HomeWatch {
  const binding = useRef(orderHomeWatch(createHomeWatchBinding())).current;
  const [status, setStatusState] = useState<HomeWatchStatus | null>(null);
  // The owner's switches as last saved or being saved: a save builds on this, never on a render that may be stale.
  const latestSettings = useRef<HomeWatchSettings | null>(null);
  // null is a call a newer one has replaced; the newer answer is the one to show.
  const setStatus = useCallback((s: HomeWatchStatus | null) => {
    if (s === null) return;
    latestSettings.current = s.supported ? s.settings : null;
    setStatusState(s);
  }, []);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      binding.getHomeWatch().then(
        (s) => !cancelled && setStatus(s),
        () => !cancelled && setStatus({ supported: false }),
      );
      notificationsGranted(false).then((ok) => !cancelled && setNotificationsAllowed(ok), () => undefined);
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [binding, setStatus]);

  const settings = status?.supported ? status.settings : null;
  const onHome = settings?.home != null && settings.home.networkId === currentNetworkId;
  const watching = settings !== null && (settings.whoIsHome || settings.newDevices);

  useEffect(() => {
    if (!settings?.home || !iface || !onHome || !scanDone || !watching) return;
    const gatewayIp = settings.home.gatewayIp;
    let cancelled = false;
    const timer = setTimeout(() => {
      void readHomeRouter(net, iface, locationsByIp.get(gatewayIp) ?? []).then((router) => {
        if (cancelled || router === null) return;
        const home = postScanSyncHome(latestSettings.current, router, networkName);
        if (home) binding.syncHome(home, homeWatchSnapshot(devices)).then(setStatus, () => undefined);
      });
    }, SYNC_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [binding, devices, onHome, scanDone, watching]);

  const updateHomeWatch = useCallback(
    async (patch: Partial<Omit<HomeWatchSettings, 'home'>>): Promise<string | null> => {
      const before = latestSettings.current;
      const prev = before ?? DEFAULT_HOME_WATCH_SETTINGS;
      const next: HomeWatchSettings = { ...prev, ...patch };
      if (!next.whoIsHome && !next.newDevices) next.home = null;
      else if (!prev.whoIsHome && !prev.newDevices) {
        const gatewayIp = iface?.gatewayIp ?? null;
        if (iface === null || gatewayIp === null || currentNetworkId === null || hashNetworkId(gatewayIp, MAX_SWEEP_PREFIX) !== currentNetworkId) {
          return 'Run a check on your home Wi-Fi first, then turn this on.';
        }
        const router = await readHomeRouter(net, iface, locationsByIp.get(gatewayIp) ?? []);
        if (router === null) return NO_ROUTER_ID; // fail closed (my call): the router address alone is not home
        next.home = { networkId: currentNetworkId, gatewayIp, label: networkName ?? 'your home Wi-Fi', ...router };
      }
      if (patch.newDevices) setNotificationsAllowed(await notificationsGranted(true).catch(() => false));
      // Only a home pinned just now has a checked router; otherwise the post-scan sync sends the list once it has checked.
      const pinned = next.home !== null && next.home !== prev.home;
      latestSettings.current = next;
      try {
        setStatus(await binding.setHomeWatch(next, pinned ? homeWatchSnapshot(devices) : null));
        return null;
      } catch (e: unknown) {
        latestSettings.current = before;
        return `HomeNet could not save this setting: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    [binding, currentNetworkId, devices, iface, locationsByIp, net, networkName, setStatus],
  );

  const markDeviceMine = useCallback(
    async (ip: string): Promise<void> => {
      setStatus(await binding.markDeviceMine(ip));
    },
    [binding, setStatus],
  );

  return useMemo(
    () => ({ status, notificationsAllowed, updateHomeWatch, markDeviceMine }),
    [markDeviceMine, notificationsAllowed, status, updateHomeWatch],
  );
}
