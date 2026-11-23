import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import InflowCore, { type HealthDay, type HealthStatus } from 'inflow-core';
import { ACCESS_NOT_GIVEN, REFRESH_DAYS, REFRESH_FAILED, SHOWN_DAYS, fillSeries, lastDays, shouldRefresh, vitalsState, type VitalsState } from './vitals.ts';

// Kept outside the hook so closing and reopening the section does not reset the 15 minute gap.
let lastRunAt: number | null = null;

export interface Vitals {
  loaded: boolean;
  status: HealthStatus | null;
  state: VitalsState | null;
  series: HealthDay[];
  now: number;
  busy: boolean;
  message: string | null;
  refresh: () => void;
  allow: () => void;
}

// Loads what is saved, then refreshes from Health Connect when the section opens and when the app comes back, at most every 15 minutes. Refresh and Allow access always run.
export function useVitals(): Vitals {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [series, setSeries] = useState<HealthDay[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const running = useRef(false);

  const load = useCallback(async (): Promise<HealthStatus | null> => {
    try {
      const at = Date.now();
      const days = lastDays(at, SHOWN_DAYS);
      const s = await InflowCore.healthStatus();
      setStatus(s);
      setSeries(fillSeries(days, InflowCore.healthDays(days[0], days[days.length - 1])));
      setNow(at);
      return s;
    } catch {
      setMessage(REFRESH_FAILED);
      return null;
    } finally {
      setLoaded(true);
    }
  }, []);

  const run = useCallback(
    async (manual: boolean) => {
      if (running.current) return;
      const s = await load();
      const canRead = s !== null && s.availability === 'available' && (s.steps || s.sleep || s.heartRate);
      if (!canRead || !shouldRefresh(lastRunAt, Date.now(), manual)) return;
      running.current = true;
      setBusy(true);
      lastRunAt = Date.now();
      try {
        const r = await InflowCore.refreshHealth(REFRESH_DAYS);
        setMessage(r.ok ? null : (r.message ?? REFRESH_FAILED));
      } catch {
        setMessage(REFRESH_FAILED);
      }
      running.current = false;
      setBusy(false);
      await load();
    },
    [load],
  );

  const allow = useCallback(async () => {
    try {
      const ok = await InflowCore.requestHealthPermissions();
      setMessage(ok ? null : ACCESS_NOT_GIVEN);
    } catch {
      setMessage(REFRESH_FAILED);
    }
    await run(true);
  }, [run]);

  useEffect(() => {
    void run(false);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run(false);
    });
    return () => sub.remove();
  }, [run]);

  const state = status === null ? null : vitalsState(status, series);
  return { loaded, status, state, series, now, busy, message, refresh: () => void run(true), allow: () => void allow() };
}
