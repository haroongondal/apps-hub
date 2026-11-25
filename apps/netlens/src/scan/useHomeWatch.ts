// Background checks run natively without JS, so after each scan on the home network the device list
// is handed to native, debounced (name lookups change the rows several times per scan).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  createHomeWatchController,
  orderHomeWatch,
  readHomeRouter,
  type HomeWatchPatch,
  type HomeWatchStatus,
  type InterfaceInfo,
  type NetLensNativeBinding,
  type ReconciledDevice,
} from '@apps-hub/core';
import { createHomeWatchBinding } from 'netlens-core';

const SYNC_DELAY_MS = 2000;

export interface HomeWatch {
  status: HomeWatchStatus | null;
  notificationsAllowed: boolean;
  updateHomeWatch(patch: HomeWatchPatch): Promise<string | null>;
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
  const [status, setStatusState] = useState<HomeWatchStatus | null>(null);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);
  // The ordering and save rules live in core (createHomeWatchController) where node tests them.
  const [controller] = useState(() =>
    createHomeWatchController(orderHomeWatch(createHomeWatchBinding()), {
      onStatus: setStatusState,
      onNotificationsAllowed: setNotificationsAllowed,
      notificationsGranted,
    }),
  );
  const setStatus = controller.apply;
  const readRouter = useCallback(
    (gatewayIp: string) => (iface ? readHomeRouter(net, iface, locationsByIp.get(gatewayIp) ?? []) : Promise.resolve(null)),
    [iface, locationsByIp, net],
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      controller.getHomeWatch().then(
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
  }, [controller, setStatus]);

  const settings = status?.supported ? status.settings : null;
  const onHome = settings?.home != null && settings.home.networkId === currentNetworkId;
  const watching = settings !== null && (settings.whoIsHome || settings.newDevices);

  useEffect(() => {
    if (!settings?.home || !iface || !onHome || !scanDone || !watching) return;
    const gatewayIp = settings.home.gatewayIp;
    let cancelled = false;
    const timer = setTimeout(() => {
      void readRouter(gatewayIp).then((router) => {
        if (cancelled || router === null) return;
        void controller.syncAfterScan(router, networkName, devices);
      });
    }, SYNC_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [controller, devices, onHome, scanDone, watching]);

  const updateHomeWatch = useCallback(
    (patch: HomeWatchPatch) => controller.update(patch, { iface, currentNetworkId, networkName, devices, readRouter }),
    [controller, currentNetworkId, devices, iface, networkName, readRouter],
  );

  const markDeviceMine = useCallback((ip: string) => controller.markDeviceMine(ip), [controller]);

  return useMemo(
    () => ({ status, notificationsAllowed, updateHomeWatch, markDeviceMine }),
    [markDeviceMine, notificationsAllowed, status, updateHomeWatch],
  );
}
