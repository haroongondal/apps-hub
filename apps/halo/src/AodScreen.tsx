import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Header, Pill, Row, Screen, Segmented, Sheet, space } from '@apps-hub/ui';
import HaloEngine, { DOT_KINDS, type AodTimeout, type AodTrigger, type ChargeEffect, type DotKind, type Settings } from 'halo-engine';
import { addSlot, commitSlots, MAX_SLOTS, newTheme, slotErrors, type Slot } from './aodForm.ts';
import { ThemePicture } from './FacePicker.tsx';
import { parseTime } from './notifyForm.ts';
import { SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

type TimeoutKey = '10' | '30' | '60' | '300' | '900' | '1800' | 'never';
const key = (t: AodTimeout): TimeoutKey => (t === null ? 'never' : (String(t) as TimeoutKey));
const toTimeout = (k: TimeoutKey): AodTimeout => (k === 'never' ? null : (Number(k) as AodTimeout));
const SHORT = [
  { key: '10', label: '10 s', a11yLabel: '10 seconds' },
  { key: '30', label: '30 s', a11yLabel: '30 seconds' },
  { key: '60', label: '1 min', a11yLabel: '1 minute' },
  { key: '300', label: '5 min', a11yLabel: '5 minutes' },
] as const satisfies ReadonlyArray<{ key: TimeoutKey; label: string; a11yLabel: string }>;
const LONG = [
  { key: '900', label: '15 min', a11yLabel: '15 minutes' },
  { key: '1800', label: '30 min', a11yLabel: '30 minutes' },
  { key: 'never', label: 'Never stop' },
] as const satisfies ReadonlyArray<{ key: TimeoutKey; label: string; a11yLabel?: string }>;

const TRIGGERS = [
  { key: 'always', label: 'Always' },
  { key: 'charging', label: 'Charging' },
  { key: 'music', label: 'Music' },
] as const satisfies ReadonlyArray<{ key: AodTrigger; label: string }>;
const TRIGGER_NOTE: Record<AodTrigger, string> = {
  always: 'Shows whenever the phone is locked.',
  charging: 'Shows only while the phone is charging.',
  music: 'Shows only while music is playing.',
};

const DOT_LABELS: Record<DotKind, string> = {
  charging: 'Charging',
  lowBattery: 'Low battery',
  call: 'Missed calls',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  message: 'Messages',
  email: 'Email',
  other: 'Other apps',
  alarm: 'Alarm',
  media: 'Music',
};
const CHARGE_EFFECTS = [
  { key: 'off', label: 'Off' },
  { key: 'sweep', label: 'Sweep' },
] as const satisfies ReadonlyArray<{ key: ChargeEffect; label: string }>;

const NEVER_NOTE = 'Uses more battery. The screen still turns off with the power button.';
const TIME_ERROR = 'Use 24-hour time, like 22:00.';

export default function AodScreen({ settings, update, onOpenTheme }: { settings: Settings; update: UpdateSettings; onOpenTheme: (id: string) => void }) {
  const a = settings.aod;
  const themes = settings.themes;
  const setAod = (patch: Partial<Settings['aod']>) => update({ aod: patch });
  const themeName = (id: string) => themes.find((t) => t.id === id)?.name ?? 'Unknown theme';
  const [start, setStart] = useState(a.schedule.start);
  const [end, setEnd] = useState(a.schedule.end);
  // Slot rows as typed, in the order they were added; the settings keep the sorted, valid set.
  const [rows, setRows] = useState<Slot[]>(a.slots);
  const [choosing, setChoosing] = useState<number | null>(null);

  const editTime = (which: 'start' | 'end', text: string) => {
    (which === 'start' ? setStart : setEnd)(text);
    const t = parseTime(text);
    if (t) setAod({ schedule: { ...a.schedule, [which]: t } });
  };
  const changeRows = (next: Slot[]) => {
    setRows(next);
    const valid = commitSlots(next);
    if (valid) setAod({ slots: valid });
  };
  const addTheme = () => {
    const base = themes.find((t) => t.id === a.themeId) ?? themes[0];
    const created = newTheme(themes, base);
    if (!created) return;
    update({ themes: [...themes, created] });
    onOpenTheme(created.id);
  };
  const faceNames = new Map(HaloEngine.listFaces().map((f) => [f.id, f.name]));
  const errors = slotErrors(rows);

  return (
    <Screen scroll>
      <Header title="Always-on" subtitle="A dim clock on the locked screen, with the edge lights if you like." />
      <Group>
        <SwitchRow title="Always-on screen" value={a.enabled} onChange={(enabled) => setAod({ enabled })} />
      </Group>
      <Group title="Stop after" footer={a.timeoutSec === null ? NEVER_NOTE : undefined}>
        <View style={{ padding: space.md, gap: space.sm }}>
          <Segmented options={SHORT} value={key(a.timeoutSec)} onChange={(k) => setAod({ timeoutSec: toTimeout(k) })} accessibilityLabel="Stop after, short" />
          <Segmented options={LONG} value={key(a.timeoutSec)} onChange={(k) => setAod({ timeoutSec: toTimeout(k) })} accessibilityLabel="Stop after, long" />
        </View>
      </Group>
      <Group title="Show when" footer={TRIGGER_NOTE[a.trigger]}>
        <View style={{ padding: space.md }}>
          <Segmented options={TRIGGERS} value={a.trigger} onChange={(trigger) => setAod({ trigger })} accessibilityLabel="Show when" />
        </View>
      </Group>
      <Group>
        <SwitchRow title="Off hours" subtitle="The always-on screen stays off between these times." value={a.schedule.on} onChange={(on) => setAod({ schedule: { ...a.schedule, on } })} />
        {a.schedule.on && (
          <Row
            title={
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Field label="From" value={start} onChangeText={(t) => editTime('start', t)} maxLength={5} mono error={parseTime(start) ? null : TIME_ERROR} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Until" value={end} onChangeText={(t) => editTime('end', t)} maxLength={5} mono error={parseTime(end) ? null : TIME_ERROR} />
                </View>
              </View>
            }
          />
        )}
        <SwitchRow
          title="Wake for new notifications"
          subtitle="Show the always-on screen for new notifications. Only when the phone is locked."
          value={settings.notify.wakeScreen}
          onChange={(wakeScreen) => update({ notify: { wakeScreen } })}
        />
      </Group>
      <Group title="Status dots" footer="Bright dots in the top corner, each kind with its own colour and shape.">
        <SwitchRow title="Show status dots" value={a.dots.on} onChange={(on) => setAod({ dots: { ...a.dots, on } })} />
        {a.dots.on &&
          DOT_KINDS.map((k) => (
            <SwitchRow key={k} title={DOT_LABELS[k]} value={a.dots.kinds[k]} onChange={(v) => setAod({ dots: { ...a.dots, kinds: { ...a.dots.kinds, [k]: v } } })} />
          ))}
        {a.dots.on && <SwitchRow title="Show counts" subtitle="A number on a dot for two or more notifications." value={a.dots.count} onChange={(count) => setAod({ dots: { ...a.dots, count } })} />}
      </Group>
      <Group title="Charging effect" footer={a.chargeEffect === 'sweep' ? 'A light sweeps around the edges of the always-on screen while charging.' : undefined}>
        <View style={{ padding: space.md }}>
          <Segmented options={CHARGE_EFFECTS} value={a.chargeEffect} onChange={(chargeEffect) => setAod({ chargeEffect })} accessibilityLabel="Charging effect" />
        </View>
      </Group>
      <Group title="Themes" trailing={<Button label="Add theme" variant="secondary" size="sm" disabled={themes.length >= 20} onPress={addTheme} />}>
        {themes.map((t) => (
          <Row
            key={t.id}
            leading={<ThemePicture theme={t} width={40} />}
            title={t.name}
            subtitle={faceNames.get(t.face) ?? 'Big digits'}
            accessibilityHint="Edit this theme"
            onPress={() => onOpenTheme(t.id)}
            trailing={t.id === a.themeId ? <Pill label="In use" tone="accent" /> : <Button label="Use" variant="secondary" size="sm" accessibilityHint={`Use ${t.name} on the always-on screen`} onPress={() => setAod({ themeId: t.id })} />}
          />
        ))}
      </Group>
      <Group title="Time slots" footer={`A theme starts at its time and stays until the next slot. Up to ${MAX_SLOTS}. Without slots, the theme in use shows all day.`}>
        {rows.map((r, i) => (
          <Row
            key={i}
            title={
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Field label={`Slot ${i + 1} starts at`} value={r.start} onChangeText={(t) => changeRows(rows.map((x, j) => (j === i ? { ...x, start: t } : x)))} maxLength={5} mono error={errors[i]} />
                  </View>
                  <Button label="Remove" variant="ghost" size="sm" onPress={() => changeRows(rows.filter((_, j) => j !== i))} />
                </View>
                <Button label={`Theme: ${themeName(r.themeId)}`} variant="secondary" block onPress={() => setChoosing(i)} accessibilityHint="Choose the theme for this slot" />
              </View>
            }
          />
        ))}
        <Row title={<Button label="Add a time slot" variant="secondary" block disabled={rows.length >= MAX_SLOTS} onPress={() => changeRows(addSlot(rows, a.themeId) ?? rows)} />} />
      </Group>
      <Sheet visible={choosing !== null} onClose={() => setChoosing(null)} title="Theme for this slot">
        <Group>
          {themes.map((t) => {
            const on = choosing !== null && rows[choosing]?.themeId === t.id;
            return (
              <Row
                key={t.id}
                title={t.name}
                trailing={on ? <Pill label="Selected" tone="accent" /> : undefined}
                accessibilityLabel={on ? `${t.name}, selected` : t.name}
                onPress={() => {
                  if (choosing !== null) changeRows(rows.map((x, j) => (j === choosing ? { ...x, themeId: t.id } : x)));
                  setChoosing(null);
                }}
              />
            );
          })}
        </Group>
      </Sheet>
    </Screen>
  );
}
