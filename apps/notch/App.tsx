import React, { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, ThemeProvider } from '@apps-hub/ui';
import NotchIsland from 'notch-island';
import { notchStatus } from './src/status';

export default function App() {
  return (
    <ThemeProvider brand="notch">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const read = useCallback(() => notchStatus(NotchIsland.canDrawOverlay(), NotchIsland.isRunning()), []);
  const [status, setStatus] = useState(read);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setStatus(read()));
    return () => sub.remove();
  }, [read]);

  const toggle = (on: boolean) => {
    NotchIsland.setEnabled(on);
    // The service starts a beat after the call returns.
    setTimeout(() => setStatus(read()), 400);
  };

  return (
    <Screen scroll>
      <Header title="Notch" subtitle="A pill around your camera. Tap it to expand." />
      {status === 'needs-permission' && (
        <Notice
          tone="warn"
          title="Allow display over other apps"
          action={<Button label="Open settings" variant="secondary" size="sm" onPress={() => NotchIsland.openOverlaySettings()} />}
        >
          Notch draws its pill over your other apps, so Android asks you first. Turn on Notch there, then come back.
        </Notice>
      )}
      <Group title="Pill">
        <Row
          title={status === 'on' ? 'On' : 'Off'}
          subtitle={status === 'on' ? 'The pill sits around your camera. It folds back after four seconds.' : 'Turn it on to show the pill.'}
          trailing={
            <Button
              label={status === 'on' ? 'Turn off' : 'Turn on'}
              variant={status === 'on' ? 'secondary' : 'primary'}
              size="sm"
              disabled={status === 'needs-permission'}
              onPress={() => toggle(status !== 'on')}
            />
          }
        />
      </Group>
    </Screen>
  );
}
