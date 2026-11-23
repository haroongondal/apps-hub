// Background checks run natively without JS, so after each scan on the home network the device list
// is handed to native, debounced (name lookups change the rows several times per scan).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  DEFAULT_HOME_WATCH_SETTINGS,
  MAX_SWEEP_PREFIX,
  hashNetworkId,
  homeWatchSnapshot,
  type HomeWatchSettings,
  type HomeWatchStatus,
  type InterfaceInfo,
  type ReconciledDevice,
} from '@apps-hub/core';
import { createHomeWatchBinding } from 'netlens-core';

const SYNC_DELAY_MS = 2000;

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
): HomeWatch {
  const binding = useRef(createHomeWatchBinding()).current;
  const [status, setStatus] = useState<HomeWatchStatus | null>(null);
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
  }, [binding]);

  const settings = status?.supported ? status.settings : null;
  const onHome = settings?.home != null && settings.home.networkId === currentNetworkId;
  const watching = settings !== null && (settings.whoIsHome || settings.newDevices);

  useEffect(() => {
    if (!settings || !onHome || !scanDone || !watching) return;
    const timer = setTimeout(() => {
      const home = settings.home && networkName ? { ...settings.home, label: networkName } : settings.home;
      binding.setHomeWatch({ ...settings, home }, homeWatchSnapshot(devices)).then(setStatus, () => undefined);
    }, SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [binding, devices, onHome, scanDone, watching]);

  const updateHomeWatch = useCallback(
    async (patch: Partial<Omit<HomeWatchSettings, 'home'>>): Promise<string | null> => {
      const prev = settings ?? DEFAULT_HOME_WATCH_SETTINGS;
      const next: HomeWatchSettings = { ...prev, ...patch };
      if (!next.whoIsHome && !next.newDevices) next.home = null;
      else if (!prev.whoIsHome && !prev.newDevices) {
        const gatewayIp = iface?.gatewayIp ?? null;
        if (gatewayIp === null || currentNetworkId === null || hashNetworkId(gatewayIp, MAX_SWEEP_PREFIX) !== currentNetworkId) {
          return 'Run a check on your home Wi-Fi first, then turn this on.';
        }
        next.home = { networkId: currentNetworkId, gatewayIp, label: networkName ?? 'your home Wi-Fi' };
      }
      if (patch.newDevices) setNotificationsAllowed(await notificationsGranted(true).catch(() => false));
      const sameNetwork = next.home !== null && next.home.networkId === currentNetworkId;
      try {
        setStatus(await binding.setHomeWatch(next, sameNetwork ? homeWatchSnapshot(devices) : null));
        return null;
      } catch (e: unknown) {
        return `HomeNet could not save this setting: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
    [binding, currentNetworkId, devices, iface, networkName, settings],
  );

  const markDeviceMine = useCallback(
    async (ip: string): Promise<void> => {
      setStatus(await binding.markDeviceMine(ip));
    },
    [binding],
  );

  return useMemo(
    () => ({ status, notificationsAllowed, updateHomeWatch, markDeviceMine }),
    [markDeviceMine, notificationsAllowed, status, updateHomeWatch],
  );
}
