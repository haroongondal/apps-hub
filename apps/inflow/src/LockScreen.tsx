import React, { useEffect, useRef, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import InflowCore from 'inflow-core';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const unlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await InflowCore.authenticate();
      if (!alive.current) return;
      if (result.ok) return onUnlocked();
      if (result.message !== null) setMessage(result.message);
    } catch {
      if (alive.current) setMessage("Inflow couldn't ask for your fingerprint. Close and reopen the app, then try again.");
    }
    if (alive.current) setBusy(false);
  };

  useEffect(() => {
    alive.current = true;
    void unlock();
    return () => {
      alive.current = false;
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
