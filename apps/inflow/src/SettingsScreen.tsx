import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Group, Header, Notice, Row, Screen, Segmented, Sheet, Text } from '@apps-hub/ui';
import InflowCore, { type AppSetting, type SenderName, type Status } from 'inflow-core';
import { AiSettings } from './AiSettings.tsx';
import { keepLabel } from './format.ts';
import { GmailSettings } from './GmailSettings.tsx';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';
import { setupRowElements, useSetupAction } from './SetupScreen.tsx';
import { setupRows } from './setup.ts';

const KEEP = [null, 365, 90, 30] as const;
const keepKey = (days: number | null) => (days === null ? 'forever' : String(days));
const KEEP_OPTIONS = KEEP.map((d) => ({ key: keepKey(d), label: keepLabel(d) }));
const RECORD_OPTIONS = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;
const AI_OPTIONS = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;
const LOCK_NOTE = "Your fingerprint locks these screens. Your history is encrypted with a key this phone keeps, so Inflow can keep saving notifications while it's locked.";

function blockTitle(key: string, apps: AppSetting[], names: SenderName[]): string {
  const id = key.slice(key.indexOf(':') + 1);
  if (key.startsWith('app:')) return apps.find((a) => a.pkg === id)?.label ?? id;
  return names.find((n) => n.senderKey === id)?.name ?? id;
}

export function SettingsScreen({ status, refreshStatus }: { status: Status; refreshStatus: () => void }) {
  const [apps, setApps] = useState<AppSetting[]>([]);
  const [names, setNames] = useState<SenderName[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<AppSetting | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [blocks, setBlocks] = useState<string[]>([]);
  const { run, notice } = useSetupAction(refreshStatus);

  const load = useCallback(() => {
    try {
      setApps(InflowCore.listApps());
      setNames(InflowCore.listSenderNames());
      setOwnerName(InflowCore.getOwnerName() ?? '');
      setBlocks(InflowCore.listAiBlocks());
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(load, [load]);

  const change = (apply: () => void) => {
    try {
      apply();
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    load();
  };
  const saveOwnerName = () => change(() => InflowCore.setOwnerName(ownerName.trim() === '' ? null : ownerName.trim()));
  const stop = (deleteSaved: boolean) => {
    const app = stopping;
    setStopping(null);
    if (app) change(() => InflowCore.setRecord(app.pkg, false, deleteSaved));
  };

  return (
    <Screen scroll>
      <Header title="Settings" />
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Group title="Apps" footer="Choose which apps Inflow saves from and how long it keeps their notifications.">
        {apps.map((a) => (
          <Row key={a.pkg} title={a.label}>
            <Segmented
              accessibilityLabel={`Save notifications from ${a.label}`}
              options={RECORD_OPTIONS}
              value={a.record ? 'on' : 'off'}
              onChange={(k) => {
                if (k === 'on' && !a.record) change(() => InflowCore.setRecord(a.pkg, true, false));
                else if (k === 'off' && a.record) setStopping(a);
              }}
            />
            <Segmented
              accessibilityLabel={`Send ${a.label} to AI`}
              options={AI_OPTIONS}
              value={blocks.includes(`app:${a.pkg}`) ? 'off' : 'on'}
              onChange={(k) => change(() => InflowCore.setAiBlocked(`app:${a.pkg}`, k === 'off'))}
            />
            <Segmented
              accessibilityLabel={`Keep ${a.label} notifications for`}
              options={KEEP_OPTIONS}
              value={keepKey(a.keepDays)}
              onChange={(k) => change(() => InflowCore.setKeep(a.pkg, k === 'forever' ? null : Number(k)))}
            />
          </Row>
        ))}
      </Group>
      <Field
        label="Your name"
        hint="Inflow uses it to spot transfers between your own accounts."
        value={ownerName}
        onChangeText={setOwnerName}
        onEndEditing={saveOwnerName}
        returnKeyType="done"
        autoCapitalize="words"
      />
      <GmailSettings />
      <AiSettings />
      <Group title="Kept from AI" footer="Inflow never sends these to the AI.">
        {blocks.length === 0 ? (
          <Row title={<Text tone="muted">Nothing is kept from AI</Text>} />
        ) : (
          blocks.map((b) => (
            <Row
              key={b}
              title={blockTitle(b, apps, names)}
              subtitle={b.startsWith('app:') ? 'App' : 'Sender'}
              trailing={<Button label="Remove" variant="ghost" size="sm" onPress={() => change(() => InflowCore.setAiBlocked(b, false))} />}
            />
          ))
        )}
      </Group>
      <Group title="Renamed senders">
        {names.length === 0 ? (
          <Row title={<Text tone="muted">No renamed senders yet</Text>} />
        ) : (
          names.map((n) => <Row key={n.senderKey} title={n.name} subtitle={n.sender} onPress={() => setRenaming({ senderKey: n.senderKey, sender: n.sender, name: n.name })} />)
        )}
      </Group>
      <Group title="Setup">
        {setupRowElements(setupRows(status), run)}
      </Group>
      {notice}
      <Notice>{LOCK_NOTE}</Notice>
      <Sheet visible={stopping !== null} onClose={() => setStopping(null)} title="Stop saving?" doneLabel="Cancel">
        <Text>{`Stop saving ${stopping?.label ?? 'this app'}? Also delete the items already saved from it?`}</Text>
        <Button label="Stop and delete" variant="danger" onPress={() => stop(true)} block />
        <Button label="Stop, keep saved items" variant="secondary" onPress={() => stop(false)} block />
        <Button label="Cancel" variant="ghost" onPress={() => setStopping(null)} block />
      </Sheet>
      <RenameSheet
        target={renaming}
        onClose={() => setRenaming(null)}
        onSaved={() => {
          setRenaming(null);
          load();
        }}
      />
    </Screen>
  );
}
