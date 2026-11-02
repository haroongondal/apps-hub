import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ActivityEntry, FirewallApi, FirewallRuleKind, FirewallStatus } from 'open-tunnel-native';

import { joinAppUse, type AppUseRow } from './data-use.ts';

export const STATUS_POLL_MS = 2000;
export const APPS_POLL_MS = 30_000;
export const ACTIVITY_LIMIT = 100;

export interface ActivityView {
  uid?: number;
  blockedOnly: boolean;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sameStatus = (a: FirewallStatus, b: FirewallStatus) =>
  a.enabled === b.enabled && a.running === b.running && a.paused === b.paused && a.usageAccess === b.usageAccess;

export function useFirewall(api: FirewallApi, view: ActivityView) {
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [apps, setApps] = useState<AppUseRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const latest = useRef(0);

  const readLive = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const [next, entries] = await Promise.all([
        api.getFirewallStatus(),
        api.getActivityLog({ uid: view.uid, blockedOnly: view.blockedOnly, limit: ACTIVITY_LIMIT }),
      ]);
      if (!mounted.current || mine !== latest.current) return;
      setStatus((current) => (current !== null && sameStatus(current, next) ? current : next));
      setActivity(entries);
      setReadError(null);
    } catch (error) {
      if (mounted.current && mine === latest.current) setReadError(message(error));
    }
  }, [api, view.uid, view.blockedOnly]);

  const readApps = useCallback(async () => {
    try {
      const [rules, use] = await Promise.all([api.getAppRules(), api.getDataUse()]);
      if (mounted.current) setApps(joinAppUse(rules, use));
    } catch (error) {
      if (mounted.current) setReadError(message(error));
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void readApps();
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void readApps();
    }, APPS_POLL_MS);
    // Back from the VPN dialog or the Usage access screen: read again now, not at the next tick.
    const resume = AppState.addEventListener('change', (state) => {
      if (state === 'active') void readApps();
    });
    return () => {
      mounted.current = false;
      clearInterval(poll);
      resume.remove();
    };
  }, [readApps]);

  useEffect(() => {
    void readLive();
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void readLive();
    }, STATUS_POLL_MS);
    return () => clearInterval(poll);
  }, [readLive]);

  const act = useCallback(
    async (run: () => Promise<void>) => {
      setBusy(true);
      setActionError(null);
      try {
        await run();
      } catch (error) {
        if (mounted.current) setActionError(message(error));
      }
      if (mounted.current) setBusy(false);
      await readLive();
    },
    [readLive],
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([readLive(), readApps()]);
    if (mounted.current) setRefreshing(false);
  }, [readLive, readApps]);

  const setRule = useCallback(
    (uid: number, rule: FirewallRuleKind) =>
      act(async () => {
        await api.setAppRule(uid, rule);
        setApps((current) => current && current.map((app) => (app.uid === uid ? { ...app, rule } : app)));
      }),
    [api, act],
  );

  return {
    status,
    apps,
    activity,
    readError,
    actionError,
    busy,
    refreshing,
    reload,
    dismissActionError: () => setActionError(null),
    enable: () => act(() => api.setFirewallEnabled(true)),
    disable: () => act(() => api.setFirewallEnabled(false)),
    setPaused: (paused: boolean) => act(() => api.setPaused(paused)),
    openUsageAccess: () => act(() => api.openUsageAccessSettings()),
    setRule,
  };
}
