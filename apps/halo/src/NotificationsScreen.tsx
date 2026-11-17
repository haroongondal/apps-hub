import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Field, Group, Header, Pill, Row, Segmented, Sheet, Text, space, useTheme } from '@apps-hub/ui';
import HaloEngine, { type AppNotify, type ReminderMin, type Settings } from 'halo-engine';
import { AppIcon, AppList, SearchField, useApps } from './AppPicker.tsx';
import { appSetting, parseTime } from './notifyForm.ts';
import { Stepper, SwitchRow, Toggle } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

type StyleKey = 'pulse' | 'sweep' | 'pattern';
const STYLES = [
  { key: 'pulse', label: 'Pulse' },
  { key: 'sweep', label: 'Sweep' },
  { key: 'pattern', label: 'Pattern' },
] as const satisfies ReadonlyArray<{ key: StyleKey; label: string }>;

type ReminderKey = 'off' | '1' | '2' | '5' | '10' | '15';
const REMINDERS: ReadonlyArray<{ key: ReminderKey; label: string; a11yLabel: string }> = [
  { key: 'off', label: 'Off', a11yLabel: 'No reminder' },
  ...([1, 2, 5, 10, 15] as const).map((m) => ({ key: String(m) as ReminderKey, label: String(m), a11yLabel: m === 1 ? 'Every minute' : `Every ${m} minutes` })),
];

const HEX = /^#?[0-9a-fA-F]{6}$/;
const hex = (text: string) => `#${text.trim().replace('#', '').toUpperCase()}`;
const TIME_ERROR = 'Use 24-hour time, like 22:00.';
const seconds = (v: number) => `${v} s`;

export default function NotificationsScreen({ settings, update }: { settings: Settings; update: UpdateSettings }) {
  const { c } = useTheme();
  const n = settings.notify;
  const set = (patch: Partial<Settings['notify']>) => update({ notify: patch });
  const patterns = useMemo(() => HaloEngine.listPatterns(), []);
  const apps = useApps();
  const [query, setQuery] = useState('');
  const [start, setStart] = useState(n.quiet.start);
  const [end, setEnd] = useState(n.quiet.end);
  const [editing, setEditing] = useState<{ pkg: string; label: string } | null>(null);
  const [draft, setDraft] = useState('');

  const styleKey: StyleKey = n.style === 'pulse' || n.style === 'sweep' ? n.style : 'pattern';
  const setApp = (pkg: string, patch: Partial<AppNotify>) => set({ apps: { ...n.apps, [pkg]: { ...appSetting(n, pkg), ...patch } } });
  const editTime = (which: 'start' | 'end', text: string) => {
    (which === 'start' ? setStart : setEnd)(text);
    const t = parseTime(text);
    if (t) set({ quiet: { ...n.quiet, [which]: t } });
  };
  const openColour = (pkg: string, label: string) => {
    setEditing({ pkg, label });
    setDraft(appSetting(n, pkg).colour ?? '');
  };
  const draftOk = HEX.test(draft.trim());
  const saveColour = () => {
    if (!editing) return;
    if (draftOk) setApp(editing.pkg, { colour: hex(draft) });
    else if (draft.trim() !== '') return;
    setEditing(null);
  };

  const header = (
    <View style={{ gap: space.xl }}>
      <Header title="Notifications" subtitle="The edges flash when a notification arrives." />
      <Group>
        <SwitchRow title="Notification flashes" value={n.enabled} onChange={(enabled) => set({ enabled })} />
      </Group>
      {n.enabled && (
        <>
          <Group title="Flash style" footer={styleKey === 'pattern' ? 'Pick the pattern below.' : undefined}>
            <View style={{ padding: space.md }}>
              <Segmented
                options={STYLES}
                value={styleKey}
                onChange={(k) => set({ style: k === 'pattern' ? (styleKey === 'pattern' ? n.style : settings.pattern) : k })}
                accessibilityLabel="Flash style"
              />
            </View>
            <Stepper label="Flashes" value={n.repeat} min={1} max={5} step={1} onChange={(repeat) => set({ repeat })} />
            <Stepper label="Length" value={n.durationMs / 1000} min={0.5} max={5} step={0.5} show={seconds} onChange={(v) => set({ durationMs: Math.round(v * 1000) })} />
          </Group>
          {styleKey === 'pattern' && (
            <Group title="Pattern">
              {patterns.map((pt) => (
                <Row
                  key={pt.id}
                  title={pt.name}
                  trailing={pt.id === n.style ? <Pill label="Selected" tone="accent" /> : undefined}
                  accessibilityLabel={pt.id === n.style ? `${pt.name}, selected` : pt.name}
                  onPress={() => set({ style: pt.id })}
                />
              ))}
            </Group>
          )}
          <Group title="Reminder, in minutes" footer="Flashes again until you unlock the phone.">
            <View style={{ padding: space.md }}>
              <Segmented
                options={REMINDERS}
                value={n.reminderMin === null ? 'off' : (String(n.reminderMin) as ReminderKey)}
                onChange={(k) => set({ reminderMin: k === 'off' ? null : (Number(k) as ReminderMin) })}
                accessibilityLabel="Reminder"
              />
            </View>
          </Group>
          <Group>
            <SwitchRow title="Quiet hours" subtitle="No flashes between these times." value={n.quiet.on} onChange={(on) => set({ quiet: { ...n.quiet, on } })} />
            {n.quiet.on && (
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
          </Group>
          <Group title="Apps">
            <SwitchRow title="Flash for new apps" subtitle="Apps you have not set below flash too." value={n.defaultOn} onChange={(defaultOn) => set({ defaultOn })} />
          </Group>
          <SearchField value={query} onChange={setQuery} />
        </>
      )}
    </View>
  );

  const current = editing ? appSetting(n, editing.pkg) : null;

  return (
    <>
      <AppList
        apps={n.enabled ? apps : []}
        query={query}
        header={header}
        renderRow={(a) => {
          const s = appSetting(n, a.pkg);
          return (
            <Row
              leading={<AppIcon pkg={a.pkg} label={a.label} />}
              title={a.label}
              subtitle={s.colour ? `Colour ${s.colour}` : 'Colour from the icon'}
              accessibilityHint="Change the flash colour"
              onPress={() => openColour(a.pkg, a.label)}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  {/* The swatch shows the person's own colour, so it is the one place a colour comes from data, not the theme. */}
                  <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: s.colour ?? 'transparent' }} />
                  <Toggle label={`Flash for ${a.label}`} value={s.on} onChange={(on) => setApp(a.pkg, { on })} />
                </View>
              }
            />
          );
        }}
      />
      <Sheet visible={editing !== null} onClose={() => setEditing(null)} title={editing ? `${editing.label} colour` : ''} doneLabel="Save" onDone={saveColour}>
        <Group>
          <Row
            title="Colour from the app icon"
            trailing={current?.colour === null ? <Pill label="Selected" tone="accent" /> : undefined}
            onPress={() => {
              if (editing) setApp(editing.pkg, { colour: null });
              setEditing(null);
            }}
          />
        </Group>
        <Field
          label="Or type a colour"
          value={draft}
          onChangeText={setDraft}
          placeholder="#22D3EE"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          mono
          error={draft.trim() === '' || draftOk ? null : 'Use six hex digits, like #22D3EE.'}
        />
        <Text variant="meta" tone="muted">
          Save keeps the typed colour. The next flash from this app uses it.
        </Text>
      </Sheet>
    </>
  );
}
