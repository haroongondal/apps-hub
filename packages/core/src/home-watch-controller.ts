import { hashNetworkId, type ReconciledDevice } from './device-repository.ts';
import {
  DEFAULT_HOME_WATCH_SETTINGS,
  homeWatchSnapshot,
  postScanSyncHome,
  type HomeWatchSettings,
  type HomeWatchStatus,
  type OrderedHomeWatch,
} from './home-watch.ts';
import type { InterfaceInfo } from './model.ts';
import { MAX_SWEEP_PREFIX } from './subnet-calculator.ts';

export const NO_ROUTER_ID =
  "Your router doesn't tell HomeNet its ID, so HomeNet can't tell your home Wi-Fi from another one that uses the same router address. " +
  "Turn on UPnP in your router's settings, run a check, then try again.";

export interface RouterRef {
  routerId: string;
  routerUrl: string;
}

export interface HomeWatchContext {
  iface: InterfaceInfo | null;
  currentNetworkId: string | null;
  networkName: string | null;
  devices: readonly ReconciledDevice[];
  readRouter(gatewayIp: string): Promise<RouterRef | null>;
}

export interface HomeWatchHooks {
  onStatus(status: HomeWatchStatus): void;
  onNotificationsAllowed(allowed: boolean): void;
  notificationsGranted(ask: boolean): Promise<boolean>;
}

export type HomeWatchPatch = Partial<Omit<HomeWatchSettings, 'home'>>;

/** React-free core of useHomeWatch, so node can test it against a fake native binding. */
export function createHomeWatchController(binding: OrderedHomeWatch, hooks: HomeWatchHooks) {
  // The owner's switches as last saved or being saved: a save builds on this, never on a render that may be stale.
  let latest: HomeWatchSettings | null = null;
  // Saves wait for each other: one that starts later builds on what the earlier one left, not on what it saw before its own waits.
  let saves: Promise<unknown> = Promise.resolve();

  // A null answer belongs to a call a newer one replaced: the newer answer is the one to show.
  const apply = (s: HomeWatchStatus | null): void => {
    if (s === null) return;
    latest = s.supported ? s.settings : null;
    hooks.onStatus(s);
  };

  const save = async (patch: HomeWatchPatch, ctx: HomeWatchContext): Promise<string | null> => {
    const prev = latest ?? DEFAULT_HOME_WATCH_SETTINGS;
    const next: HomeWatchSettings = { ...prev, ...patch };
    if (!next.whoIsHome && !next.newDevices) next.home = null;
    else if (!prev.whoIsHome && !prev.newDevices) {
      const { iface, currentNetworkId, networkName } = ctx;
      const gatewayIp = iface?.gatewayIp ?? null;
      if (iface === null || gatewayIp === null || currentNetworkId === null || hashNetworkId(gatewayIp, MAX_SWEEP_PREFIX) !== currentNetworkId) {
        return 'Run a check on your home Wi-Fi first, then turn this on.';
      }
      const router = await ctx.readRouter(gatewayIp);
      if (router === null) return NO_ROUTER_ID; // fail closed (my call): the router address alone is not home
      next.home = { networkId: currentNetworkId, gatewayIp, label: networkName ?? 'your home Wi-Fi', ...router };
    }
    if (patch.newDevices) hooks.onNotificationsAllowed(await hooks.notificationsGranted(true).catch(() => false));
    // Only a home pinned just now has a checked router; otherwise the post-scan sync sends the list once it has checked.
    const pinned = next.home !== null && next.home !== prev.home;
    const before = latest;
    latest = next;
    try {
      apply(await binding.setHomeWatch(next, pinned ? homeWatchSnapshot(ctx.devices) : null));
      return null;
    } catch (e: unknown) {
      latest = before;
      return `HomeNet could not save this setting: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  return {
    latestSettings: (): HomeWatchSettings | null => latest,
    apply,
    getHomeWatch: (): Promise<HomeWatchStatus | null> => binding.getHomeWatch(),

    update(patch: HomeWatchPatch, ctx: HomeWatchContext): Promise<string | null> {
      const result = saves.then(() => save(patch, ctx));
      saves = result.catch(() => undefined);
      return result;
    },

    syncAfterScan(router: RouterRef, networkName: string | null, devices: readonly ReconciledDevice[]): Promise<void> {
      const home = postScanSyncHome(latest, router, networkName);
      if (!home) return Promise.resolve();
      return binding.syncHome(home, homeWatchSnapshot(devices)).then(apply, () => undefined);
    },

    async markDeviceMine(ip: string): Promise<void> {
      apply(await binding.markDeviceMine(ip));
    },
  };
}
