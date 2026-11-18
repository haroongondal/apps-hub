import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import InflowCore from 'inflow-core';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);

  const unlock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await InflowCore.authenticate();
      if (!alive.current) return;
      if (result.ok) return onUnlocked();
      if (result.message !== null) setMessage(result.message);
    } catch {
      if (alive.current) setMessage("Inflow couldn't ask for your fingerprint. Close and reopen the app, then try again.");
    } finally {
      inFlight.current = false;
    }
    if (alive.current) setBusy(false);
  };

  // The app locks as it goes to the background; the prompt waits until it is in front again (one asked from the background is never shown).
  useEffect(() => {
    alive.current = true;
    if (AppState.currentState === 'active') void unlock();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void unlock();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, []);

  return (
    <Screen scroll>
      <Header title="Inflow" subtitle="Use your fingerprint or phone PIN to open your history." />
      {message !== null && <Notice tone="warn">{message}</Notice>}
      <Button label="Unlock" onPress={unlock} busy={busy} block />
    </Screen>
  );
}
