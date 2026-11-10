import { useCallback, useEffect, useRef, useState } from 'react';
import Vault, { addSyncListener, type EmailRecoveryStatus } from 'strongroom-vault';
import { syncSettled } from './sync-flow.ts';

// Loads on mount and after each finished sync run. A failure gives null (callers show nothing); only the newest answer counts, so a slow older call can't overwrite it.
export function useEmailRecovery() {
  const [state, setState] = useState<{ status: EmailRecoveryStatus | null; now: number; loaded: boolean }>({ status: null, now: Date.now(), loaded: false });
  const latest = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    let status: EmailRecoveryStatus | null = null;
    try {
      status = await Vault.emailRecoveryStatus();
    } catch {
      // Worker slow, offline or vault locked: no status is the honest answer here.
    }
    if (mounted.current && mine === latest.current) setState({ status, now: Date.now(), loaded: true });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    // Not while a run is in flight: the status call waits on the same lock.
    const sub = addSyncListener((s) => {
      if (syncSettled(s)) void reload();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [reload]);

  return { ...state, reload };
}
