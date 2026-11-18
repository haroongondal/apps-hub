import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Group, Header, Notice, Row, Screen, Segmented, Text } from '@apps-hub/ui';
import type { Kind } from '@apps-hub/autopilot-contract';
import InflowCore, { type PickableChat } from 'inflow-core';
import { formFromSettings, settingsForSave, toggleChat, type SettingsForm } from './autopilot.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';
import { useHardwareBack } from './useHardwareBack.ts';

const INTRO = "Autopilot sends a chat's messages to the AI only for the chats you pick here. Everything else still stays SMS and email only.";
const ON_OFF = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;
const KIND_ROWS: ReadonlyArray<{ kind: Kind; title: string; subtitle: string }> = [
  { kind: 'reply', title: 'Replies', subtitle: 'Suggest a reply to a message that needs one.' },
  { kind: 'bill', title: 'Bills', subtitle: 'Suggest paying a bill before it is due.' },
  { kind: 'event', title: 'Events', subtitle: 'Suggest adding an event to your calendar.' },
  { kind: 'money', title: 'Payments to check', subtitle: 'Flag a payment that looks unusual.' },
];

// The settings the owner edits, picked chats first by search. Nothing is saved until Save.
export function AutopilotSettings({ onBack }: { onBack: () => void }) {
  useHardwareBack(onBack);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [chats, setChats] = useState<PickableChat[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    try {
      setForm(formFromSettings(InflowCore.autopilotSettings()));
      setChats(InflowCore.pickableChats());
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(load, [load]);

  if (form === null) {
    return (
      <Screen scroll>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="Autopilot" />
        {error !== null && <Notice tone="danger">{error}</Notice>}
      </Screen>
    );
  }

  const edit = (patch: Partial<SettingsForm>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const toggleKind = (kind: Kind, on: boolean) => edit({ kinds: on ? (form.kinds.includes(kind) ? form.kinds : [...form.kinds, kind]) : form.kinds.filter((k) => k !== kind) });
  const save = () => {
    const result = settingsForSave(form);
    if (!result.ok) {
      setError(result.error);
      setSaved(false);
      return;
    }
    try {
      InflowCore.setAutopilotSettings(result.settings);
      // Show what was stored: bad values fall back to their defaults.
      setForm(formFromSettings(InflowCore.autopilotSettings()));
      setError(null);
      setSaved(true);
    } catch {
      setError(SAVE_ERROR);
      setSaved(false);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = chats.filter((c) => q === '' || c.name.toLowerCase().includes(q) || c.app.toLowerCase().includes(q));
  // A picked chat can fall out of the newest 200; keep it listed so it can still be unpicked.
  const listed = new Set(chats.map((c) => c.id));
  const hidden = q === '' ? form.pickedChats.filter((id) => !listed.has(id)) : [];

  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
      <Header title="Autopilot" />
      <Notice>{INTRO}</Notice>
      {error !== null && (
        <Notice tone="danger" title="Autopilot settings weren't saved">
          {error}
        </Notice>
      )}
      {saved && <Notice tone="ok">Saved.</Notice>}
      <Group title="Suggest">
        {KIND_ROWS.map((k) => (
          <Row key={k.kind} title={k.title} subtitle={k.subtitle}>
            <Segmented accessibilityLabel={`Suggest ${k.title.toLowerCase()}`} options={ON_OFF} value={form.kinds.includes(k.kind) ? 'on' : 'off'} onChange={(v) => toggleKind(k.kind, v === 'on')} />
          </Row>
        ))}
        <Row title="Calendar reminder" subtitle="Alarm 30 minutes before events">
          <Segmented accessibilityLabel="Alarm 30 minutes before events" options={ON_OFF} value={form.alarmBefore ? 'on' : 'off'} onChange={(v) => edit({ alarmBefore: v === 'on' })} />
        </Row>
      </Group>
      <Group title="Payments to check" footer="Amounts are in rupees (PKR). A payment out is flagged when it is the multiple times your usual for its category and at least the minimum, or when it is above the large amount. Money in from a name you have not seen is also flagged.">
        <Field label="Multiple of your usual" value={form.multiple} onChangeText={(v) => edit({ multiple: v })} keyboardType="number-pad" mono />
        <Field label="Minimum amount (PKR)" value={form.minRupees} onChangeText={(v) => edit({ minRupees: v })} keyboardType="decimal-pad" mono />
        <Field label="Large amount (PKR)" value={form.hugeRupees} onChangeText={(v) => edit({ hugeRupees: v })} keyboardType="decimal-pad" mono />
        <Field label="Bank app" hint="The app's package name, for example com.example.bank. Leave blank for none." value={form.bankApp} onChangeText={(v) => edit({ bankApp: v })} autoCapitalize="none" autoCorrect={false} mono />
      </Group>
      <Field
        label="Apps Deputy may look in"
        hint="Package names, one per line, for example com.google.android.apps.maps. Deputy may look in these besides the chat's own app. Leave empty for your contacts, maps, calendar and photos apps."
        value={form.lookIn}
        onChangeText={(v) => edit({ lookIn: v })}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        mono
      />
      <Field label="Search chats" placeholder="Name or app" value={search} onChangeText={setSearch} autoCorrect={false} />
      <Group title="Chats Autopilot may read" footer={`${form.pickedChats.length} picked.`}>
        {shown.length === 0 && hidden.length === 0 && <Row title={<Text tone="muted">{chats.length === 0 ? 'No chats yet. They appear here once a messaging app has notified you.' : 'No chat matches that search.'}</Text>} />}
        {shown.map((c) => (
          <ChatRow key={c.id} title={c.name} subtitle={c.app} on={form.pickedChats.includes(c.id)} onChange={(on) => edit({ pickedChats: toggleChat(form.pickedChats, c.id, on) })} />
        ))}
        {hidden.map((id) => (
          <ChatRow key={id} title="A chat not in the recent list" subtitle={id.slice(0, id.indexOf('|'))} on onChange={(on) => edit({ pickedChats: toggleChat(form.pickedChats, id, on) })} />
        ))}
      </Group>
      <Button label="Save" onPress={save} block />
    </Screen>
  );
}

function ChatRow({ title, subtitle, on, onChange }: { title: string; subtitle: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Row title={title} subtitle={subtitle}>
      <Segmented accessibilityLabel={`Let Autopilot read ${title}`} options={ON_OFF} value={on ? 'on' : 'off'} onChange={(v) => onChange(v === 'on')} />
    </Row>
  );
}
