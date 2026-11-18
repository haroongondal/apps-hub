import React, { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, ThemeProvider } from '@apps-hub/ui';
import NotchIsland from 'notch-island';
import { Preview } from './src/Preview';
import { SettingsScreen } from './src/SettingsScreen';
import { normalize, type NotchSettings } from './src/settings';
import { notchStatus } from './src/status';

export default function App() {
  return (
    <ThemeProvider brand="notch">
      <Home />
    </ThemeProvider>
  );
}

function loadSettings(): NotchSettings {
  return normalize(JSON.parse(NotchIsland.getSettings()));
}

function Home() {
  const read = useCallback(() => notchStatus(NotchIsland.isRunning()), []);
  const [status, setStatus] = useState(read);
  const [settings, setSettings] = useState<NotchSettings>(loadSettings);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setStatus(read()));
    return () => sub.remove();
  }, [read]);

  const save = (next: NotchSettings) => {
    setSettings(next);
    NotchIsland.setSettings(JSON.stringify(next));
  };

  const open = <Button label="Open accessibility settings" variant="secondary" size="sm" onPress={() => NotchIsland.openAccessibilitySettings()} />;

  return (
    <Screen scroll>
      <Header title="Notch" subtitle="A pill around your camera. Tap it to expand." />
      {status === 'off' && (
        <Notice tone="warn" title="Notch is off" action={open}>
          Turn on Notch in Accessibility settings, under Installed apps. Android needs this to let the pill take taps at the top of the screen. Notch does not read your screen.
        </Notice>
      )}
      <Preview value={settings} />
      <SettingsScreen value={settings} onChange={save} />
      <Group title="Status">
        <Row title={status === 'on' ? 'On' : 'Off'} subtitle={status === 'on' ? 'The pill sits around your camera.' : 'Switch Notch on in Accessibility settings to show the pill.'} />
      </Group>
    </Screen>
  );
}
