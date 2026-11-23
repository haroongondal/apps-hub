import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Group, Header, Notice, RecordMenu, Row, Screen, Segmented, Sheet, Text, confirmAction } from '@apps-hub/ui';
import InflowCore, { type AppSetting, type SenderName, type Status } from 'inflow-core';
import { AiSettings } from './AiSettings.tsx';
import { AutopilotSettings } from './AutopilotSettings.tsx';
import { HEALTH_IN_ASK_NOTE } from './doctor.ts';
import { keepLabel } from './format.ts';
import { GmailSettings } from './GmailSettings.tsx';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { mediaStatsLabel } from './media.ts';
import { keepBlockConfirm, removeNameConfirm, type Confirm } from './records.ts';
import { RenameSheet, type RenameTarget } from './RenameSheet.tsx';
import { setupRowElements, useSetupAction } from './SetupScreen.tsx';
import { setupRows } from './setup.ts';
import { SuggestionsScreen } from './SuggestionsScreen.tsx';

const KEEP = [null, 365, 90, 30] as const;
const keepKey = (days: number | null) => (days === null ? 'forever' : String(days));
const KEEP_OPTIONS = KEEP.map((d) => ({ key: keepKey(d), label: keepLabel(d) }));
const RECORD_OPTIONS = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;
const AI_OPTIONS = [
  { key: 'on', label: 'Send to AI' },
  { key: 'off', label: 'Keep from AI' },
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
  const [mediaLine, setMediaLine] = useState('');
  const [healthAsk, setHealthAsk] = useState(false);
  const [briefingShare, setBriefingShare] = useState(false);
  const [healthBriefing, setHealthBriefing] = useState(false);
  const [digest, setDigest] = useState(false);
  const [nexusAsk, setNexusAsk] = useState(false);
  const [nexusDebits, setNexusDebits] = useState(false);
  const [sub, setSub] = useState<'autopilot' | 'suggestions' | null>(null);
  const { run, notice } = useSetupAction(refreshStatus);

  const load = useCallback(() => {
    try {
      setApps(InflowCore.listApps());
      setNames(InflowCore.listSenderNames());
      setOwnerName(InflowCore.getOwnerName() ?? '');
      setBlocks(InflowCore.listAiBlocks());
      setMediaLine(mediaStatsLabel(InflowCore.mediaStats()));
      setHealthAsk(InflowCore.healthInAsk());
      setBriefingShare(InflowCore.briefingShare());
      setHealthBriefing(InflowCore.healthInBriefing());
      setDigest(InflowCore.digest());
      setNexusAsk(InflowCore.nexusAsk());
      setNexusDebits(InflowCore.nexusDebits());
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
  const ask = (c: Confirm, apply: () => void) => confirmAction({ title: c.title, message: c.message, confirmLabel: c.confirmLabel, onConfirm: () => change(apply) });
  const saveOwnerName = () => change(() => InflowCore.setOwnerName(ownerName.trim() === '' ? null : ownerName.trim()));
  const stop = (deleteSaved: boolean) => {
    const app = stopping;
    setStopping(null);
    if (app) change(() => InflowCore.setRecord(app.pkg, false, deleteSaved));
  };

  if (sub === 'autopilot') return <AutopilotSettings onBack={() => setSub(null)} />;
  if (sub === 'suggestions') return <SuggestionsScreen onBack={() => setSub(null)} />;

  return (
    <Screen scroll>
      <Header title="Settings" />
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Group title="Setup">
        {setupRowElements(setupRows(status), run)}
      </Group>
      {notice}
      <Field
        label="Your name"
        hint="Your full name as your bank writes it. Inflow uses it to spot transfers between your own accounts."
        value={ownerName}
        onChangeText={setOwnerName}
        onEndEditing={saveOwnerName}
        returnKeyType="done"
        autoCapitalize="words"
      />
      <Group title="Autopilot">
        <Row title="Autopilot" subtitle="Choose what Inflow suggests and which chats it reads" onPress={() => setSub('autopilot')} />
        <Row title="Suggestions" subtitle="What is waiting and what you ran or skipped" onPress={() => setSub('suggestions')} />
      </Group>
      <GmailSettings />
      <AiSettings />
      <Group title="Health in Ask AI" footer={HEALTH_IN_ASK_NOTE}>
        <Row title="Include health in Ask AI">
          <Segmented accessibilityLabel="Include health in Ask AI" options={RECORD_OPTIONS} value={healthAsk ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setHealthInAsk(k === 'on'))} />
        </Row>
      </Group>
      <Group title="Morning briefing">
        <Row title="Share my morning briefing with my other Haroon apps" subtitle="Other apps of yours can read the briefing lines on this phone. Nothing leaves the phone.">
          <Segmented accessibilityLabel="Share my morning briefing with my other Haroon apps" options={RECORD_OPTIONS} value={briefingShare ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setBriefingShare(k === 'on'))} />
        </Row>
        <Row title="Include medicines and steps in my morning briefing" subtitle="Adds your next medicine time and today's steps. Off keeps health numbers out of the briefing.">
          <Segmented accessibilityLabel="Include medicines and steps in my morning briefing" options={RECORD_OPTIONS} value={healthBriefing ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setHealthInBriefing(k === 'on'))} />
        </Row>
        <Row title="Morning and evening summary" subtitle="Inflow posts what is due and what you spent at 08:00 and 20:00. Nothing leaves the phone.">
          <Segmented accessibilityLabel="Morning and evening summary" options={RECORD_OPTIONS} value={digest ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setDigest(k === 'on'))} />
        </Row>
      </Group>
      <Group title="Nexus">
        <Row title="Let Nexus read my messages" subtitle="Nexus can search your text messages and emails on this phone, to answer your questions. Nothing leaves the phone.">
          <Segmented accessibilityLabel="Let Nexus read my messages" options={RECORD_OPTIONS} value={nexusAsk ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setNexusAsk(k === 'on'))} />
        </Row>
        <Row title="Let Nexus match my receipts" subtitle="Nexus can see the money you spent in the last 60 days to match receipts. Nothing leaves the phone.">
          <Segmented accessibilityLabel="Let Nexus match my receipts" options={RECORD_OPTIONS} value={nexusDebits ? 'on' : 'off'} onChange={(k) => change(() => InflowCore.setNexusDebits(k === 'on'))} />
        </Row>
      </Group>
      <Group title="Kept from AI" footer="Inflow never sends these to the AI.">
        {blocks.length === 0 ? (
          <Row title={<Text tone="muted">Nothing is kept from AI</Text>} />
        ) : (
          blocks.map((b) => (
            <Row
              key={b}
              title={blockTitle(b, apps, names)}
              subtitle={b.startsWith('app:') ? 'App' : 'Sender'}
              trailing={<Button label="Remove" variant="ghost" size="sm" onPress={() => ask(keepBlockConfirm(blockTitle(b, apps, names)), () => InflowCore.setAiBlocked(b, false))} />}
            />
          ))
        )}
      </Group>
      <Group title="Renamed senders">
        {names.length === 0 ? (
          <Row title={<Text tone="muted">No renamed senders yet</Text>} />
        ) : (
          names.map((n) => {
            const edit = () => setRenaming({ senderKey: n.senderKey, sender: n.sender, name: n.name });
            const c = removeNameConfirm(n.name, n.sender);
            return (
              <Row
                key={n.senderKey}
                title={n.name}
                subtitle={n.sender}
                onPress={edit}
                trailing={
                  <RecordMenu
                    title={n.name}
                    actions={[
                      { label: 'Edit', onPress: edit },
                      { label: 'Remove name', onPress: () => change(() => InflowCore.renameSender(n.senderKey, null)), destructive: true, confirmTitle: c.title, confirmMessage: c.message, confirmLabel: c.confirmLabel },
                    ]}
                  />
                }
              />
            );
          })
        )}
      </Group>
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
            {a.aiEligible ? (
              <Segmented
                accessibilityLabel={`Send ${a.label} to AI`}
                options={AI_OPTIONS}
                value={blocks.includes(`app:${a.pkg}`) ? 'off' : 'on'}
                onChange={(k) => change(() => InflowCore.setAiBlocked(`app:${a.pkg}`, k === 'off'))}
              />
            ) : (
              <Text variant="caption" tone="muted">
                Never sent to AI
              </Text>
            )}
            <Segmented
              accessibilityLabel={`Keep ${a.label} notifications for`}
              options={KEEP_OPTIONS}
              value={keepKey(a.keepDays)}
              onChange={(k) => change(() => InflowCore.setKeep(a.pkg, k === 'forever' ? null : Number(k)))}
            />
          </Row>
        ))}
      </Group>
      <Group title="Saved media" footer="Photos, videos and files that WhatsApp shows in its notifications are saved here, encrypted, and kept as long as the message.">
        <Row title={mediaLine} />
      </Group>
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
