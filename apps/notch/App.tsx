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
  const read = useCallback(() => notchStatus(NotchIsland.isRunning()), []);
  const [status, setStatus] = useState(read);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setStatus(read()));
    return () => sub.remove();
  }, [read]);

  const open = <Button label="Open accessibility settings" variant="secondary" size="sm" onPress={() => NotchIsland.openAccessibilitySettings()} />;

  return (
    <Screen scroll>
      <Header title="Notch" subtitle="A pill around your camera. Tap it to expand." />
      {status === 'off' && (
        <Notice tone="warn" title="Notch is off" action={open}>
          Turn on Notch in Accessibility settings, under Installed apps. Android needs this to let the pill take taps at the top of the screen. Notch does not read your screen.
        </Notice>
      )}
      <Group title="Pill">
        <Row
          title={status === 'on' ? 'On' : 'Off'}
          subtitle={status === 'on' ? 'The pill sits around your camera. It folds back after four seconds. To turn it off, switch Notch off in Accessibility settings.' : 'Switch Notch on in Accessibility settings to show the pill.'}
        />
      </Group>
    </Screen>
  );
}
