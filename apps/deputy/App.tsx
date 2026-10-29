import React, { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, View } from 'react-native';
import { Button, Field, Group, Header, Notice, Pill, Row, Screen, Text, ThemeProvider, space, useTheme } from '@apps-hub/ui';
import DeputyAgent, { type TreeDump } from 'deputy-agent';
import { RunPanel } from './src/RunPanel';
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
  const { c } = useTheme();
  const [state, setState] = useState(() => DeputyAgent.getServiceState());
  const [keyOpen, setKeyOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [dump, setDump] = useState<TreeDump | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setState(DeputyAgent.getServiceState()), []);

  useEffect(() => DeputyAgent.setPalette(JSON.stringify(c)), [c]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const rows = setupRows(state);

  const act = async (action: SetupAction) => {
    if (action === 'accessibility') DeputyAgent.openAccessibilitySettings();
    else if (action === 'battery') DeputyAgent.openBatterySettings();
    else if (action === 'appInfo') DeputyAgent.openAppInfo();
    else if (action === 'key') setKeyOpen(true);
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
      <Header title="Deputy" subtitle="Tell Deputy a task, and it works your phone's apps to do it." />
      {!state.accessibilityEnabled && (
        <Notice tone="danger" title="Deputy is off">
          Turn on the Deputy accessibility service. Without it Deputy cannot read or tap other apps.
        </Notice>
      )}
      <RunPanel state={state} refresh={refresh} />
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
      {(keyOpen || !state.keySet) && <KeyPanel keySet={state.keySet} refresh={refresh} />}
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

function KeyPanel({ keySet, refresh }: { keySet: boolean; refresh: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await DeputyAgent.testProvider());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="API key" footer={keySet ? 'A key is saved. Deputy never shows it again.' : 'Deputy uses Gemini 3.8 Flash. Create a key in Google AI Studio.'}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Notice tone="warn" title="Free-tier keys share what Deputy sees">
          With a free-tier key, Google may use what Deputy sends, including screens from your messaging and money apps, to improve its products. A key from a project with billing turned on avoids that.
        </Notice>
        <Field label="Gemini API key" value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} mono />
        <Button
          label={keySet ? 'Replace the key' : 'Save the key'}
          onPress={() => {
            DeputyAgent.setApiKey(key.trim());
            setKey('');
            setResult(null);
            refresh();
          }}
          disabled={key.trim() === ''}
          block
        />
        {keySet && <Button label="Test the key" variant="secondary" onPress={test} busy={busy} block />}
        {keySet && (
          <Button
            label="Remove the key"
            variant="ghost"
            onPress={() => {
              DeputyAgent.clearApiKey();
              setResult(null);
              refresh();
            }}
            block
          />
        )}
        {result && (
          <Notice tone={result.ok ? 'ok' : 'danger'} title={result.ok ? 'The key works' : 'The key test failed'}>
            {result.message}
          </Notice>
        )}
      </View>
    </Group>
  );
}
