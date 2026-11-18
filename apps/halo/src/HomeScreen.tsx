import React, { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid } from 'react-native';
import { Group, Header, Pill, Row, Screen } from '@apps-hub/ui';
import HaloEngine, { type Settings, type Status } from 'halo-engine';
import { ready, setupRows, type SetupRow } from './setup.ts';
import { SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

const RUNTIME = {
  audio: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  notifications: PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
} as const;

function statusLine(s: Status, enabled: boolean, setupDone: boolean): string {
  if (!enabled) return 'The lights are off.';
  if (!setupDone) return 'Finish setting up below to see the lights.';
  if (!s.running) return 'Halo is not running. Turn the lights off and on again.';
  if (s.audio === 'blocked') return 'Another visualizer app is using the audio. Close it to see the lights.';
  if (s.playingApp !== null || s.audio === 'ok') return 'Music is playing.';
  return 'Waiting for music.';
}

export default function HomeScreen({ settings, update, onOpen }: { settings: Settings; update: UpdateSettings; onOpen: (to: 'edges' | 'diagnostics' | 'rules' | 'island') => void }) {
  const [status, setStatus] = useState<Status>(() => HaloEngine.getStatus());
  const refresh = useCallback(() => setStatus(HaloEngine.getStatus()), []);

  useEffect(() => {
    const sub = HaloEngine.addStatusListener(setStatus);
    const app = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      sub.remove();
      app.remove();
    };
  }, [refresh]);

  const fix = async (key: SetupRow['key']) => {
    if (key === 'audio' || key === 'notifications') {
      const result = await PermissionsAndroid.request(RUNTIME[key]);
      // Once refused for good, the system dialog no longer shows; the switch lives on Halo's settings page.
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) HaloEngine.openPermission('appDetails');
      refresh();
    } else {
      HaloEngine.openPermission(key);
    }
  };

  const rows = setupRows(status, settings);
  const setupDone = ready(rows);

  return (
    <Screen scroll>
      <Header title="Halo" subtitle={statusLine(status, settings.enabled, setupDone)} />
      <Group>
        <SwitchRow title="Edge lights" subtitle="Light up the screen edges to the music." value={settings.enabled} onChange={(enabled) => update({ enabled })} />
      </Group>
      <Group title="Setup" footer={setupDone ? 'Halo has what it needs.' : 'Tap a step to allow it.'}>
        {rows.map((r) => (
          <Row
            key={r.key}
            title={r.label}
            trailing={r.done ? <Pill label="Done" tone="ok" /> : <Pill label={r.key === 'battery' || r.key === 'usage' ? 'Recommended' : 'Needed'} tone="warn" />}
            onPress={() => fix(r.key)}
          />
        ))}
      </Group>
      <Group>
        <Row title="Screen edges" subtitle="Fit the lights to the corners of your screen." onPress={() => onOpen('edges')} />
        <Row title="When to hide the lights" subtitle="Full screen, calls, battery saver and chosen apps." onPress={() => onOpen('rules')} />
        <Row title="Notch" subtitle="A pill around your camera. Tap it to expand." onPress={() => onOpen('island')} />
        <Row title="Diagnostics" subtitle="Setup check and the event log." onPress={() => onOpen('diagnostics')} />
      </Group>
    </Screen>
  );
}
