import React, { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Share } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Text } from '@apps-hub/ui';
import HaloEngine, { type PermissionKind, type Status } from 'halo-engine';

const AUDIO_COPY: Record<Status['audio'], string> = {
  ok: 'Sound is reaching Halo.',
  blocked: 'Another app is holding the audio effect. Close it and start again.',
  idle: 'No sound has reached Halo yet. Play something.',
};

const SYSTEM_ROWS: { kind: PermissionKind; title: string; key: 'overlayAllowed' | 'listenerAllowed'; hint: string }[] = [
  { kind: 'overlay', title: 'Show over other apps', key: 'overlayAllowed', hint: 'Lets Halo draw the lights.' },
  { kind: 'listener', title: 'Notification access', key: 'listenerAllowed', hint: 'Lets Halo see which app is playing.' },
];

export default function DiagnosticsScreen() {
  const [status, setStatus] = useState<Status>(() => HaloEngine.getStatus());
  const [log, setLog] = useState(() => HaloEngine.probeLog());

  const refresh = useCallback(() => {
    setStatus(HaloEngine.getStatus());
    setLog(HaloEngine.probeLog());
  }, []);

  useEffect(() => {
    const sub = HaloEngine.addStatusListener((s) => {
      setStatus(s);
      setLog(HaloEngine.probeLog());
    });
    const app = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      sub.remove();
      app.remove();
    };
  }, [refresh]);

  const askRuntime = async () => {
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ]);
    refresh();
  };

  const lines = log.split('\n');
  const tail = lines.slice(-40).join('\n');

  return (
    <Screen scroll>
      <Header title="Halo" subtitle="Setup check" />
      {status.audio === 'blocked' && <Notice tone="warn" title="Audio is blocked">{AUDIO_COPY.blocked}</Notice>}
      <Group title="Permissions">
        <Row
          title="Microphone and notifications"
          subtitle="Audio capture needs the microphone permission."
          trailing={<Text tone="muted">{status.audioAllowed && status.notificationsAllowed ? 'Allowed' : 'Off'}</Text>}
          onPress={askRuntime}
        />
        {SYSTEM_ROWS.map((r) => (
          <Row
            key={r.kind}
            title={r.title}
            subtitle={r.hint}
            trailing={<Text tone="muted">{status[r.key] ? 'Allowed' : 'Off'}</Text>}
            onPress={() => HaloEngine.openPermission(r.kind)}
          />
        ))}
        <Row title="Battery use" subtitle="Choose no restrictions so Halo keeps running." onPress={() => HaloEngine.openPermission('battery')} />
        <Row title="App settings" subtitle="Open Halo's page in system settings." onPress={() => HaloEngine.openPermission('appDetails')} />
      </Group>
      <Group title="Lights">
        <Row title={status.running ? 'Halo is running' : 'Halo is stopped'} subtitle={AUDIO_COPY[status.audio]} />
        <Row title={<Button label={status.running ? 'Stop' : 'Start'} variant={status.running ? 'secondary' : 'primary'} block onPress={() => (status.running ? HaloEngine.stop() : HaloEngine.start())} />} />
      </Group>
      <Group title="Probe log">
        <Row title={<Text variant="data" selectable>{tail || 'The log is empty.'}</Text>} />
        <Row title={<Button label="Refresh" variant="secondary" block onPress={refresh} />} />
        <Row title={<Button label="Share log" variant="secondary" block onPress={() => Share.share({ message: HaloEngine.probeLog() })} />} />
        <Row title={<Button label="Clear log" variant="ghost" block onPress={() => { HaloEngine.clearProbeLog(); refresh(); }} />} />
      </Group>
    </Screen>
  );
}
