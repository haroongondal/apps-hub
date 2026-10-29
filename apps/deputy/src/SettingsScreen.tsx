import React, { useState } from 'react';
import { PermissionsAndroid, View } from 'react-native';
import { Button, Field, Group, Header, Notice, Pill, Row, Screen, Text, space } from '@apps-hub/ui';
import DeputyAgent, { type ServiceState, type TreeDump } from 'deputy-agent';
import { fromForm, toForm, type SettingsForm } from './settingsForm';
import { setupComplete, setupRows, type SetupAction, type SetupRow } from './setup';

const PILLS = {
  ok: { label: 'On', tone: 'ok' },
  todo: { label: 'To do', tone: 'warn' },
  manual: { label: 'Check yourself', tone: 'neutral' },
} as const;

const PRICES = [
  ['inputPerM', 'Input'],
  ['cachedPerM', 'Cached input'],
  ['outputPerM', 'Output'],
] as const;

const LIMITS = [
  ['maxSteps', 'Steps per task', 'number-pad'],
  ['maxCostUsd', 'Dollars per task', 'decimal-pad'],
  ['maxMinutes', 'Minutes per task', 'number-pad'],
  ['dailyCostUsd', 'Dollars per day', 'decimal-pad'],
] as const;

const isGemini = (baseUrl: string) => baseUrl.includes('generativelanguage.googleapis.com');

export function SettingsScreen({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [keyOpen, setKeyOpen] = useState(false);
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

  return (
    <Screen scroll>
      <Header title="Settings" />
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
      <ModelPanel refresh={refresh} />
      <DumpPanel enabled={state.accessibilityEnabled} />
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

function ModelPanel({ refresh }: { refresh: () => void }) {
  const [form, setForm] = useState(() => toForm(DeputyAgent.getSettings()));
  const [savedUrl, setSavedUrl] = useState(form.baseUrl);
  const [result, setResult] = useState<{ error: string | null } | null>(null);

  const edit = (patch: Partial<SettingsForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setResult(null);
  };

  const save = () => {
    const error = DeputyAgent.setSettings(fromForm(form));
    setResult({ error });
    if (error) return;
    const next = toForm(DeputyAgent.getSettings());
    setForm(next);
    setSavedUrl(next.baseUrl);
    refresh();
  };

  return (
    <>
      <Group title="Model" footer="Deputy works with any service that offers the OpenAI chat format over https.">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field label="Address" value={form.baseUrl} onChangeText={(baseUrl) => edit({ baseUrl })} autoCapitalize="none" autoCorrect={false} keyboardType="url" mono />
          {form.baseUrl.trim() !== savedUrl && (
            <Notice tone="warn" title="Saving removes the API key">
              The saved key belongs to the old address, so Deputy deletes it. Add the new service's key afterwards.
            </Notice>
          )}
          <Field label="Model name" value={form.model} onChangeText={(model) => edit({ model })} autoCapitalize="none" autoCorrect={false} mono />
        </View>
      </Group>
      <Group
        title="Prices in dollars per million tokens"
        footer={form.customPrices ? 'Your own prices. Deputy counts the cost limits with them.' : "Gemini 3.5 Flash-Lite's published prices."}
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          {PRICES.map(([k, label]) => (
            <Field key={k} label={label} value={form[k]} onChangeText={(v) => edit({ [k]: v, customPrices: true })} keyboardType="decimal-pad" mono />
          ))}
          {form.customPrices && <Button label="Use Gemini Flash-Lite's prices" variant="ghost" onPress={() => edit({ customPrices: false })} block />}
        </View>
      </Group>
      <Group title="Limits" footer="A task stops at the first limit it reaches. The daily limit counts every task since midnight.">
        <View style={{ padding: space.lg, gap: space.md }}>
          {LIMITS.map(([k, label, keyboardType]) => (
            <Field key={k} label={label} value={form[k]} onChangeText={(v) => edit({ [k]: v })} keyboardType={keyboardType} mono />
          ))}
        </View>
      </Group>
      <Button label="Save settings" onPress={save} block />
      {result && (
        <Notice tone={result.error ? 'danger' : 'ok'} title={result.error ? "Settings weren't saved" : 'Settings saved'}>
          {result.error ?? 'The next task uses them.'}
        </Notice>
      )}
    </>
  );
}

function KeyPanel({ keySet, refresh }: { keySet: boolean; refresh: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const gemini = isGemini(DeputyAgent.getSettings().baseUrl);

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
    <Group
      title="API key"
      footer={keySet ? 'A key is saved. Deputy never shows it again.' : gemini ? 'Deputy uses Gemini. Create a key in Google AI Studio.' : "Use the key from the service at the address under Model."}
    >
      <View style={{ padding: space.lg, gap: space.md }}>
        {gemini && (
          <Notice tone="warn" title="Free-tier keys share what Deputy sees">
            With a free-tier key, Google may use what Deputy sends, including screens from your messaging and money apps, to improve its products. A key from a project with billing turned on avoids that.
          </Notice>
        )}
        <Field label={gemini ? 'Gemini API key' : 'API key'} value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} mono />
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

function DumpPanel({ enabled }: { enabled: boolean }) {
  const [waiting, setWaiting] = useState(false);
  const [dump, setDump] = useState<TreeDump | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <Group title="Read another app" footer="Debug. Starts a five-second countdown. Switch to the app you want to read before it ends.">
      <View style={{ padding: space.lg, gap: space.md }}>
        <Button label={waiting ? 'Reading in five seconds' : 'Read the app in front'} onPress={dumpNow} busy={waiting} disabled={!enabled} block />
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
  );
}
