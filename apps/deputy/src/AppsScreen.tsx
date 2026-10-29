import React, { useCallback, useEffect, useState } from 'react';
import { Empty, Field, Group, Header, Notice, Pill, Row, Screen, Segmented, Sheet, Text, type Tone } from '@apps-hub/ui';
import DeputyAgent, { type AppTrust, type TrustLevel } from 'deputy-agent';

const LEVELS: Record<TrustLevel, { label: string; tone: Tone; detail: string }> = {
  blocked: { label: 'Blocked', tone: 'danger', detail: "Deputy won't open this app or send its screens to the model." },
  read_only: { label: 'Read-only', tone: 'warn', detail: 'Deputy can open this app and read it, but not type or tap anything that changes it.' },
  standard: { label: 'Standard', tone: 'neutral', detail: "Deputy can use this app, and asks you first before a step that can't be undone." },
};

const OPTIONS = (['blocked', 'read_only', 'standard'] as const).map((key) => ({ key, label: LEVELS[key].label }));

export function AppsScreen() {
  const [apps, setApps] = useState<AppTrust[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<AppTrust | null>(null);

  const load = useCallback(() => {
    DeputyAgent.listApps().then(setApps);
  }, []);
  useEffect(load, [load]);

  const q = query.trim().toLowerCase();
  const shown = (apps ?? []).filter((a) => a.label.toLowerCase().includes(q) || a.pkg.includes(q));

  return (
    <Screen scroll>
      <Header title="Apps" subtitle="Choose what Deputy may do in each app." />
      <Field label="Find an app" value={query} onChangeText={setQuery} autoCorrect={false} />
      {apps === null ? (
        <Empty title="Loading your apps" />
      ) : (
        <Group footer="Money apps start read-only. Password managers, authenticators, installers and the Store start blocked.">
          {shown.map((a) => (
            <Row
              key={a.pkg}
              title={a.label}
              subtitle={a.financial ? `${a.pkg}, money app` : a.pkg}
              trailing={<Pill label={LEVELS[a.trust].label} tone={LEVELS[a.trust].tone} />}
              onPress={() => setOpen(a)}
              accessibilityHint="Changes what Deputy may do in this app"
            />
          ))}
        </Group>
      )}
      {open && <TrustSheet app={open} onClose={() => setOpen(null)} onSaved={load} />}
    </Screen>
  );
}

function TrustSheet({ app, onClose, onSaved }: { app: AppTrust; onClose: () => void; onSaved: () => void }) {
  const [level, setLevel] = useState(app.trust);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsTyping = app.financial && level === 'standard' && app.trust !== 'standard';

  const save = async () => {
    if (level === app.trust) return onClose();
    const e = await DeputyAgent.setAppTrust(app.pkg, level, needsTyping ? typed : null);
    if (e) return setError(e);
    onSaved();
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title={app.label} doneLabel="Save" onDone={save}>
      <Segmented
        options={OPTIONS}
        value={level}
        onChange={(l) => {
          setLevel(l);
          setError(null);
        }}
        accessibilityLabel={`What Deputy may do in ${app.label}`}
      />
      <Text tone="muted">{LEVELS[level].detail}</Text>
      {needsTyping && (
        <>
          <Notice tone="warn" title="This is a money app">
            Standard lets Deputy tap and type here. It still asks you before steps that pay, send or transfer, but it can miss a button with an unusual name.
          </Notice>
          <Field label={`Type ${app.label} to confirm`} value={typed} onChangeText={setTyped} autoCorrect={false} />
        </>
      )}
      {error && (
        <Notice tone="danger" title="Not changed">
          {error}
        </Notice>
      )}
    </Sheet>
  );
}
