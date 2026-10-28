import React, { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, Row, Screen, Text, ThemeProvider, space } from '@apps-hub/ui';
import DeputyAgent, { type TreeDump } from 'deputy-agent';
import { setupComplete, setupRows, type SetupAction, type SetupRow } from './src/setup';

const PILLS = {
  ok: { label: 'On', tone: 'ok' },
  todo: { label: 'To do', tone: 'warn' },
  manual: { label: 'Check yourself', tone: 'neutral' },
} as const;

export default function App() {
  return (
    <ThemeProvider brand="deputy">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const [state, setState] = useState(() => DeputyAgent.getServiceState());
  const [waiting, setWaiting] = useState(false);
  const [dump, setDump] = useState<TreeDump | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [report, setReport] = useState('');
  const [probing, setProbing] = useState(false);

  const refresh = useCallback(() => setState(DeputyAgent.getServiceState()), []);
  const showReport = () => setReport(DeputyAgent.getSpikeReport());
  const probe = async (run: (delaySeconds: number) => Promise<string>) => {
    setProbing(true);
    try {
      setReport(await run(5));
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const rows = setupRows(state);

  const act = async (action: SetupAction) => {
    if (action === 'accessibility') DeputyAgent.openAccessibilitySettings();
    else if (action === 'battery') DeputyAgent.openBatterySettings();
    else if (action === 'appInfo') DeputyAgent.openAppInfo();
    else {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (result !== 'granted') DeputyAgent.openAppInfo();
      refresh();
    }
  };

  const dumpNow = async () => {
    setWaiting(true);
    setDump(null);
    setError(null);
    try {
      setDump(await DeputyAgent.dumpForegroundTree(5));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWaiting(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="Deputy" subtitle="Set up the phone so Deputy can work in other apps." />
      {!state.accessibilityEnabled && (
        <Notice tone="danger" title="Deputy is off">
          Turn on the Deputy accessibility service. Without it Deputy cannot read or tap other apps.
        </Notice>
      )}
      <Notice title="Tasks are not available yet">This version only checks your setup and can read the screen of another app.</Notice>
      <Group title="Setup" footer={setupComplete(rows) ? 'Setup is complete.' : undefined}>
        {rows.map((r: SetupRow) => (
          <Row
            key={r.id}
            title={r.title}
            subtitle={r.detail}
            trailing={<Pill {...PILLS[r.status]} />}
            onPress={() => act(r.action)}
            accessibilityHint="Opens the screen where you can change this"
          />
        ))}
      </Group>
      <Group title="Read another app" footer="Debug. Starts a five-second countdown. Switch to the app you want to read before it ends.">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Button label={waiting ? 'Reading in five seconds' : 'Read the app in front'} onPress={dumpNow} busy={waiting} disabled={!state.accessibilityEnabled} block />
          {error && (
            <Notice tone="danger" title="Could not read the screen">
              {`${error}\nTurn the service off and on again, then retry.`}
            </Notice>
          )}
          {dump && (
            <>
              <Text variant="meta" tone="muted">
                {dump.pkg ? `${dump.pkg}, ${dump.nodes} nodes` : 'No app read'}
              </Text>
              <Text variant="data" selectable>
                {dump.text}
              </Text>
              <Button label="Copy" variant="secondary" onPress={() => DeputyAgent.copyToClipboard(dump.text)} block />
            </>
          )}
        </View>
      </Group>
      <Group
        title="Spike probes"
        footer="Debug, removed after Phase 1. Screenshots and typing: switch to the app to test within five seconds, and for typing tap into a text field first. Foreground service: tap Arm, then leave Deputy for more than a minute (locking the screen is fine). It tries on the first screen change or notification after that; come back and tap Show report. The report also lists notification events and how long the service has been connected."
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          <Button label={probing ? 'Testing' : 'Test screenshots in five seconds'} onPress={() => probe(DeputyAgent.probeScreenshots)} busy={probing} disabled={!state.accessibilityEnabled} block />
          <Button label="Test typing in five seconds" variant="secondary" onPress={() => probe(DeputyAgent.probeTyping)} busy={probing} disabled={!state.accessibilityEnabled} block />
          <Button label="Arm foreground service test" variant="secondary" onPress={() => DeputyAgent.armForegroundProbe()} disabled={!state.accessibilityEnabled} block />
          <Button label="Show report" variant="secondary" onPress={showReport} block />
          <Button label="Clear report" variant="ghost" onPress={() => { DeputyAgent.clearSpikeReport(); setReport(''); }} block />
          {report !== '' && (
            <>
              <Text variant="data" selectable>
                {report}
              </Text>
              <Button label="Copy" variant="secondary" onPress={() => DeputyAgent.copyToClipboard(report)} block />
            </>
          )}
        </View>
      </Group>
      {state.accessibilityEnabled && (
        <Button
          label="Turn off Deputy"
          variant="danger"
          onPress={() => {
            if (DeputyAgent.disableService()) setTimeout(refresh, 500);
            else DeputyAgent.openAccessibilitySettings();
          }}
          block
        />
      )}
    </Screen>
  );
}
