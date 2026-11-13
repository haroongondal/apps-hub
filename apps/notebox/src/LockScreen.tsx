import React, { useEffect, useRef, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import NoteboxCore from 'notebox-core';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const unlock = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await NoteboxCore.authenticate();
      if (!alive.current) return;
      if (result.ok) return onUnlocked();
      if (result.message !== null) setMessage(result.message);
    } catch {
      if (alive.current) setMessage("Notebox couldn't ask for your fingerprint. Close and reopen the app, then try again.");
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
      <Header title="Notebox" subtitle="Use your fingerprint or phone PIN to open your history." />
      {message !== null && <Notice tone="warn">{message}</Notice>}
      <Button label="Unlock" onPress={unlock} busy={busy} block />
    </Screen>
  );
}
