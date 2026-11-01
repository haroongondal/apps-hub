import React, { useMemo, useState } from 'react';
import { PermissionsAndroid, View } from 'react-native';
import { Button, Field, Group, Header, Notice, Pill, Row, Screen, Text, space } from '@apps-hub/ui';
import DeputyAgent, { type KnownModel, type ServiceState, type TreeDump } from 'deputy-agent';
import { fromForm, toForm, type SettingsForm } from './settingsForm';
import { setupComplete, setupRows, type SetupAction, type SetupRow } from './setup';

const PILLS = {
  ok: { label: 'On', tone: 'ok' },
  todo: { label: 'To do', tone: 'warn' },
  manual: { label: 'Check yourself', tone: 'neutral' },
  optional: { label: 'Optional', tone: 'neutral' },
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
const isGroq = (baseUrl: string) => baseUrl.includes('api.groq.com');
const known = (models: KnownModel[], f: { baseUrl: string; model: string }) =>
  models.find((m) => m.baseUrl.replace(/\/+$/, '') === f.baseUrl.trim().replace(/\/+$/, '') && m.model === f.model.trim());

export function SettingsScreen({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [keyOpen, setKeyOpen] = useState(false);
  const rows = setupRows(state);

  const act = async (action: SetupAction) => {
    if (action === 'accessibility') DeputyAgent.openAccessibilitySettings();
    else if (action === 'battery') DeputyAgent.openBatterySettings();
    else if (action === 'appInfo') DeputyAgent.openAppInfo();
    else if (action === 'key') setKeyOpen(true);
    else if (action === 'contacts') {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      if (result === 'never_ask_again') DeputyAgent.openAppInfo();
      refresh();
    } else {
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
      {(keyOpen || !state.keySet) && <KeyPanel state={state} refresh={refresh} />}
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
  const [models] = useState(() => DeputyAgent.knownModels());
  const chosen = known(models, form);

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
      <Group title="Model" footer="Deputy also works with any other service that offers the OpenAI chat format over https: type its address and model below.">
        {models.map((m) => (
          <Row
            key={m.model}
            title={m.name}
            subtitle={m.images ? 'Reads screenshots when a screen has little text.' : 'Faster. Text only, so apps that draw their own screens may not work.'}
            trailing={chosen === m ? <Pill label="Selected" tone="ok" /> : undefined}
            onPress={() =>
              edit({ baseUrl: m.baseUrl, model: m.model, customPrices: false, inputPerM: String(m.inputPerM), cachedPerM: String(m.cachedPerM), outputPerM: String(m.outputPerM) })
            }
            accessibilityHint="Fills in the address and model name"
          />
        ))}
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field label="Address" value={form.baseUrl} onChangeText={(baseUrl) => edit({ baseUrl })} autoCapitalize="none" autoCorrect={false} keyboardType="url" mono />
          {form.baseUrl.trim() !== savedUrl && (
            <Notice tone="warn" title="Each address has its own keys">
              Keys only go to the address they were saved for. If you haven't added one for this address, add it after saving: tap "Add your API key" under Setup.
            </Notice>
          )}
          <Field label="Model name" value={form.model} onChangeText={(model) => edit({ model })} autoCapitalize="none" autoCorrect={false} mono />
        </View>
      </Group>
      <Group
        title="Prices in dollars per million tokens"
        footer={form.customPrices || !chosen ? 'Your own prices. Deputy counts the cost limits with them.' : `${chosen.name}'s published prices.`}
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          {PRICES.map(([k, label]) => (
            <Field key={k} label={label} value={form[k]} onChangeText={(v) => edit({ [k]: v, customPrices: true })} keyboardType="decimal-pad" mono />
          ))}
          {form.customPrices && chosen && <Button label={`Use ${chosen.name}'s prices`} variant="ghost" onPress={() => edit({ customPrices: false })} block />}
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

function KeyPanel({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [edits, setEdits] = useState(0);
  // Each address has its own keys, so the list is read again after a settings save as well as after edits here.
  const keys = useMemo(() => DeputyAgent.listApiKeys(), [state, edits]);
  const { baseUrl } = useMemo(() => DeputyAgent.getSettings(), [state]);
  const gemini = isGemini(baseUrl);
  const groq = isGroq(baseUrl);
  const name = gemini ? 'Gemini API key' : groq ? 'Groq API key' : 'API key';

  const changed = () => {
    setEdits((n) => n + 1);
    setResult(null);
    refresh();
  };

  const add = () => {
    const e = DeputyAgent.addApiKey(key);
    setError(e);
    if (e) return;
    setKey('');
    changed();
  };

  const test = async (id: string) => {
    setTesting(id);
    setResult(null);
    try {
      setResult({ id, ...(await DeputyAgent.testProvider(id)) });
    } finally {
      setTesting(null);
    }
  };

  return (
    <Group
      title="API keys"
      footer={keys.length > 0
        ? "Deputy uses the first key until it reaches its limit, then the next. It shows only each key's last four characters."
        : gemini
          ? 'Deputy uses Gemini. Create a key in Google AI Studio.'
          : groq
            ? 'Deputy uses Groq. Create a key at console.groq.com, under API Keys.'
            : 'Use the key from the service at the address under Model.'}
    >
      {keys.map((k, i) => (
        <Row
          key={k.id}
          title={`Key ${i + 1}`}
          subtitle={`Ends in ${k.ending}`}
          mono
          trailing={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Test" variant="secondary" size="sm" onPress={() => test(k.id)} busy={testing === k.id} disabled={testing !== null} />
              <Button
                label="Remove"
                variant="ghost"
                size="sm"
                onPress={() => {
                  DeputyAgent.removeApiKey(k.id);
                  changed();
                }}
              />
            </View>
          }
        >
          {result?.id === k.id && (
            <Notice tone={result.ok ? 'ok' : 'danger'} title={result.ok ? 'The key works' : 'The key test failed'}>
              {result.message}
            </Notice>
          )}
        </Row>
      ))}
      <View style={{ padding: space.lg, gap: space.md }}>
        {gemini && (
          <Notice tone="warn" title="Free-tier keys share what Deputy sees">
            With a free-tier key, Google may use what Deputy sends, including screens from your messaging and money apps, to improve its products. A key from a project with billing turned on avoids that.
          </Notice>
        )}
        <Field
          label={keys.length > 0 ? `Another ${name}` : name}
          value={key}
          onChangeText={(v) => {
            setKey(v);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          mono
        />
        <Button label={keys.length > 0 ? 'Add the key' : 'Save the key'} onPress={add} disabled={key.trim() === ''} block />
        {error && (
          <Notice tone="danger" title="The key wasn't saved">
            {error}
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
