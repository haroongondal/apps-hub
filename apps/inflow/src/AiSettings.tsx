import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Pill, Row, Text, confirmAction, space } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type AiStatus, type KnownModelInfo } from 'inflow-core';
import { capLabel, CAP_ERROR, CAP_REACHED, parseCap, sendResultLabel } from './ai.ts';
import { whenLabel } from './format.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { removeAiKeyConfirm } from './records.ts';

const PRICES = [
  ['inputPerM', 'Input'],
  ['cachedPerM', 'Cached input'],
  ['outputPerM', 'Output'],
] as const;
type PriceKey = (typeof PRICES)[number][0];

const PRICE_ERROR = 'Enter all three prices as numbers, for example 0.15, or leave all three empty.';
const FIRST_KEY_NOTE = 'Inflow sends only what it saves from now on. Older items stay as they are.';

const isGemini = (baseUrl: string) => baseUrl.includes('generativelanguage.googleapis.com');
const isGroq = (baseUrl: string) => baseUrl.includes('api.groq.com');

export function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<KnownModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setStatus(InflowCore.aiStatus());
      setModels(InflowCore.knownModels());
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  if (status === null) return error !== null ? <Notice tone="danger">{error}</Notice> : null;
  return (
    <>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <ModelPanel status={status} models={models} onChanged={load} />
      <KeyPanel status={status} onChanged={load} />
      <RunPanel status={status} onChanged={load} />
    </>
  );
}

function ModelPanel({ status, models, onChanged }: { status: AiStatus; models: KnownModelInfo[]; onChanged: () => void }) {
  const [other, setOther] = useState(false);
  const [baseUrl, setBaseUrl] = useState(status.knownModel === null ? status.baseUrl : '');
  const [model, setModel] = useState(status.knownModel === null ? status.model : '');
  const [prices, setPrices] = useState<Record<PriceKey, string>>({ inputPerM: '', cachedPerM: '', outputPerM: '' });
  const [error, setError] = useState<string | null>(null);
  const custom = other || status.knownModel === null;

  const pick = (m: KnownModelInfo) => {
    try {
      const e = InflowCore.setAiModel(m.baseUrl, m.model, null);
      if (e === null) setOther(false);
      setError(e);
    } catch {
      setError(SAVE_ERROR);
    }
    onChanged();
  };

  const saveOther = () => {
    const given = PRICES.map(([k]) => prices[k].trim());
    const numbers = given.map(Number);
    if (given.some((g) => g !== '') && (given.some((g) => g === '') || numbers.some((n) => Number.isNaN(n)))) {
      setError(PRICE_ERROR);
      return;
    }
    try {
      setError(InflowCore.setAiModel(baseUrl.trim(), model.trim(), given[0] === '' ? null : { inputPerM: numbers[0], cachedPerM: numbers[1], outputPerM: numbers[2] }));
    } catch {
      setError(SAVE_ERROR);
    }
    onChanged();
  };

  return (
    <>
      <Group title="AI model" footer="Inflow also works with any other service that offers the OpenAI chat format over https: choose Other model and type its address and model name.">
        {models.map((m) => (
          <Row
            key={m.model}
            title={m.name}
            trailing={!custom && status.knownModel === m.name ? <Pill label="Selected" tone="ok" /> : undefined}
            onPress={() => pick(m)}
            accessibilityHint="Fills in the address and model name"
          />
        ))}
        <Row title="Other model" trailing={custom ? <Pill label="Selected" tone="ok" /> : undefined} onPress={() => setOther(true)} />
      </Group>
      {custom && (
        <>
          <Field label="Address" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" mono />
          <Field label="Model name" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} mono />
          <Group title="Prices in dollars per million tokens" footer="Inflow counts the daily limit with them.">
            <View style={{ padding: space.lg, gap: space.md }}>
              {PRICES.map(([k, label]) => (
                <Field key={k} label={label} value={prices[k]} onChangeText={(v) => setPrices((p) => ({ ...p, [k]: v }))} keyboardType="decimal-pad" mono />
              ))}
            </View>
          </Group>
          <Button label="Save model" onPress={saveOther} block />
        </>
      )}
      {error !== null && (
        <Notice tone="danger" title="The model wasn't saved">
          {error}
        </Notice>
      )}
    </>
  );
}

function KeyPanel({ status, onChanged }: { status: AiStatus; onChanged: () => void }) {
  // The key lives only in this field; it is cleared once it is saved and never logged.
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [result, setResult] = useState<{ id: number; message: string | null } | null>(null);
  const gemini = isGemini(status.baseUrl);
  const groq = isGroq(status.baseUrl);
  const name = gemini ? 'Gemini API key' : groq ? 'Groq API key' : 'API key';
  const first = status.keys.length === 0;

  const add = () => {
    let e: string | null;
    try {
      e = InflowCore.addAiKey(key);
    } catch {
      e = SAVE_ERROR;
    }
    setError(e);
    if (e === null) {
      setKey('');
      setResult(null);
    }
    onChanged();
  };

  const test = (id: number) => {
    setTesting(id);
    setResult(null);
    InflowCore.testAiKey(id)
      .then((message) => setResult({ id, message }))
      .catch(() => setResult({ id, message: SAVE_ERROR }))
      .finally(() => setTesting(null));
  };

  const askRemove = (id: number, ending: string) => {
    const c = removeAiKeyConfirm(ending);
    confirmAction({ title: c.title, message: c.message, confirmLabel: c.confirmLabel, onConfirm: () => remove(id) });
  };

  const remove = (id: number) => {
    try {
      InflowCore.removeAiKey(id);
      setResult(null);
    } catch {
      setError(SAVE_ERROR);
    }
    onChanged();
  };

  return (
    <Group
      title="API keys"
      footer={
        !first
          ? "Inflow uses the first key until it reaches its limit, then the next. It shows only each key's last four characters."
          : gemini
            ? 'Inflow uses Gemini. Create a key in Google AI Studio.'
            : groq
              ? 'Inflow uses Groq. Create a key at console.groq.com, under API Keys.'
              : 'Use the key from the service at the address under AI model.'
      }
    >
      {status.keys.map((k, i) => (
        <Row
          key={k.id}
          title={`Key ${i + 1}`}
          subtitle={`Ends in ${k.ending}`}
          mono
          trailing={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Test" variant="secondary" size="sm" onPress={() => test(k.id)} busy={testing === k.id} disabled={testing !== null} />
              <Button label="Remove" variant="ghost" size="sm" onPress={() => askRemove(k.id, k.ending)} />
            </View>
          }
        >
          {result?.id === k.id && (
            <Notice tone={result.message === null ? 'ok' : 'danger'} title={result.message === null ? 'The key works' : 'The key test failed'}>
              {result.message ?? 'The model answered.'}
            </Notice>
          )}
        </Row>
      ))}
      <View style={{ padding: space.lg, gap: space.md }}>
        {gemini && (
          <Notice tone="warn" title="Free-tier keys share what Inflow sees">
            With a free-tier key, Google may use what Inflow sends, including your messages and bank SMS, to improve its products. A key from a project with billing turned on avoids that.
          </Notice>
        )}
        {first && <Notice>{FIRST_KEY_NOTE}</Notice>}
        <Field
          label={first ? name : `Another ${name}`}
          value={key}
          onChangeText={(v) => {
            setKey(v);
            setError(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          mono
        />
        <Button label={first ? 'Save the key' : 'Add the key'} onPress={add} disabled={key.trim() === ''} block />
        {error !== null && (
          <Notice tone="danger" title="The key wasn't saved">
            {error}
          </Notice>
        )}
      </View>
    </Group>
  );
}

function RunPanel({ status, onChanged }: { status: AiStatus; onChanged: () => void }) {
  const [cap, setCap] = useState(status.capUsd === null ? '' : status.capUsd.toFixed(2));
  const [capError, setCapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);

  const saveCap = () => {
    const parsed = parseCap(cap);
    if (parsed === 'invalid') {
      setCapError(CAP_ERROR);
      return;
    }
    try {
      setCapError(InflowCore.setAiCap(parsed));
    } catch {
      setCapError(SAVE_ERROR);
    }
    onChanged();
  };

  const sendNow = () => {
    setBusy(true);
    setSent(null);
    InflowCore.sendAiNow()
      .then((r) => setSent(r.error === CAP_REACHED || r.stoppedByCap ? { tone: 'warn', text: CAP_REACHED } : r.error !== null ? { tone: 'danger', text: r.error } : { tone: 'ok', text: sendResultLabel(r.sent, r.saved) }))
      .catch(() => setSent({ tone: 'danger', text: SAVE_ERROR }))
      .finally(() => {
        setBusy(false);
        onChanged();
      });
  };

  return (
    <>
      <Field
        label="Daily limit in dollars"
        hint="Inflow stops sending for the day when it has spent this much. Leave empty for no limit."
        value={cap}
        onChangeText={setCap}
        onEndEditing={saveCap}
        keyboardType="decimal-pad"
        returnKeyType="done"
        error={capError ?? undefined}
        mono
      />
      <Group title="AI status" footer="Inflow sends only SMS and email to the AI. WhatsApp and other apps are never sent.">
        <Row title={capLabel(status.capUsd, status.spentTodayUsd)} subtitle={`${status.queued === 0 ? 'Nothing waiting' : `${status.queued} waiting`} · ${status.lastRunAt === null ? 'Not sent yet' : `Last sent ${whenLabel(status.lastRunAt, Date.now())}`}`} />
        {!status.on && <Row title={<Text tone="muted">Add an API key to turn AI on.</Text>} />}
      </Group>
      {status.error === CAP_REACHED ? (
        <Notice tone="warn">{CAP_REACHED}</Notice>
      ) : (
        status.error !== null && (
          <Notice tone="danger" title="The last send failed">
            {status.error}
          </Notice>
        )
      )}
      <Button label="Send now" variant="secondary" busy={busy} disabled={!status.on} onPress={sendNow} block />
      {sent !== null && <Notice tone={sent.tone}>{sent.text}</Notice>}
    </>
  );
}
