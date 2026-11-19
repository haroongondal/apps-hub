import React, { useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Pressable, View } from 'react-native';
import { Button, Group, Row, Segmented, useTheme } from '@apps-hub/ui';
import HaloEngine from 'halo-engine';
import NotchIsland from 'notch-island';
import {
  ACCENTS,
  CLOCKS,
  CORNERS,
  FOLDS,
  PILLS,
  SIZES,
  SWATCHES,
  WIDGETS,
  foldLabel,
  moveWidget,
  type EventSwitches,
  type NotchSettings,
  type WidgetId,
} from './settings';
import { accessLine } from './status';
import { SwitchRow } from '../Stepper.tsx';

const PILL_NAMES = { black: 'Black', graphite: 'Graphite', tinted: 'Tinted' } as const;
const SIZE_NAMES = { compact: 'Compact', regular: 'Regular', large: 'Large' } as const;
const CORNER_NAMES = { pill: 'Pill', rounded: 'Rounded', squared: 'Squared' } as const;
const CLOCK_NAMES = { '12': '12-hour', '24': '24-hour', system: 'Phone' } as const;
const WIDGET_NAMES: Record<WidgetId, string> = {
  clock: 'Clock, date and alarm',
  battery: 'Battery',
  timer: 'Timer and stopwatch',
  media: 'Now playing',
};
const BLUETOOTH = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;

export function SettingsScreen({ value, onChange }: { value: NotchSettings; onChange: (next: NotchSettings) => void }) {
  const { c } = useTheme();
  // Read on mount and each time the app comes back, e.g. from the notification access page.
  const [listener, setListener] = useState(() => NotchIsland.isListenerAllowed());
  const [bluetooth, setBluetooth] = useState(true);
  useEffect(() => {
    const checkBluetooth = () => PermissionsAndroid.check(BLUETOOTH).then(setBluetooth, () => setBluetooth(false));
    checkBluetooth();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setListener(NotchIsland.isListenerAllowed());
      checkBluetooth();
    });
    return () => sub.remove();
  }, []);
  const allowBluetooth = async () => {
    const result = await PermissionsAndroid.request(BLUETOOTH);
    // Once refused for good, the system dialog no longer shows; the switch lives on Halo's settings page.
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) HaloEngine.openPermission('appDetails');
    setBluetooth(result === PermissionsAndroid.RESULTS.GRANTED);
  };
  const set = (patch: Partial<NotchSettings>) => onChange({ ...value, ...patch });
  const setEvent = (patch: Partial<EventSwitches>) => set({ events: { ...value.events, ...patch } });
  const shown = value.widgets;
  const toggle = (id: WidgetId) => set({ widgets: shown.includes(id) ? shown.filter((w) => w !== id) : [...shown, id] });
  const shift = (id: WidgetId, by: number) => set({ widgets: moveWidget(shown, id, shown.indexOf(id) + by) });
  const order = [...shown, ...WIDGETS.filter((w) => !shown.includes(w))];

  return (
    <>
      <Group title="Look">
        <Row title="Accent" subtitle={`${value.accent[0].toUpperCase()}${value.accent.slice(1)}`} />
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
          {ACCENTS.map((a) => {
            const selected = value.accent === a;
            return (
              <Pressable
                key={a}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${a} accent`}
                onPress={() => set({ accent: a })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: SWATCHES[a],
                  borderWidth: selected ? 3 : 0,
                  borderColor: c.text,
                }}
              />
            );
          })}
        </View>
        <Row
          title="Pill colour"
          trailing={
            <Segmented
              options={PILLS.map((p) => ({ key: p, label: PILL_NAMES[p] }))}
              value={value.pill}
              onChange={(pill) => set({ pill })}
              accessibilityLabel="Pill colour"
            />
          }
        />
        <Row
          title="Size"
          trailing={
            <Segmented
              options={SIZES.map((s) => ({ key: s, label: SIZE_NAMES[s] }))}
              value={value.size}
              onChange={(size) => set({ size })}
              accessibilityLabel="Size"
            />
          }
        />
        <Row
          title="Corners"
          trailing={
            <Segmented
              options={CORNERS.map((k) => ({ key: k, label: CORNER_NAMES[k] }))}
              value={value.corners}
              onChange={(corners) => set({ corners })}
              accessibilityLabel="Corners"
            />
          }
        />
      </Group>

      <Group title="Behaviour">
        <Row
          title="Fold back after"
          subtitle={foldLabel(value.foldMs)}
          trailing={
            <Segmented
              options={FOLDS.map((f) => ({ key: String(f), label: f === 0 ? 'Never' : `${f / 1000} s` }))}
              value={String(value.foldMs)}
              onChange={(k) => set({ foldMs: Number(k) })}
              accessibilityLabel="Fold back after"
            />
          }
        />
        <Row
          title="Clock"
          trailing={
            <Segmented
              options={CLOCKS.map((k) => ({ key: k, label: CLOCK_NAMES[k] }))}
              value={value.clock}
              onChange={(clock) => set({ clock })}
              accessibilityLabel="Clock style"
            />
          }
        />
      </Group>

      <Group title="Quick events" footer="The pill opens for a few seconds, then folds back. It stays out of the way during a call or while you have it open.">
        <SwitchRow title="Charging and low battery" value={value.events.charging} onChange={(charging) => setEvent({ charging })} />
        <SwitchRow title="Ringer mode" subtitle="Ring, vibrate or silent" value={value.events.ringer} onChange={(ringer) => setEvent({ ringer })} />
        <SwitchRow title="Do not disturb" value={value.events.dnd} onChange={(dnd) => setEvent({ dnd })} />
        <SwitchRow title="Headphones connected" subtitle="Bluetooth or wired, in and out" value={value.events.bluetooth} onChange={(bluetooth) => setEvent({ bluetooth })} />
        {value.events.bluetooth && !bluetooth && (
          <Row
            title="Headphone names"
            subtitle="Allow Bluetooth to show your headphones' name, like AirPods Pro."
            trailing={<Button label="Allow Bluetooth" variant="secondary" size="sm" onPress={allowBluetooth} />}
          />
        )}
        <SwitchRow
          title="Progress from apps"
          subtitle="Rides, deliveries, navigation and downloads, shown when you open the pill"
          value={value.progressCards}
          onChange={(progressCards) => set({ progressCards })}
        />
      </Group>

      <Group title="Notification access">
        <Row
          title={listener ? 'On' : 'Off'}
          subtitle={accessLine(listener)}
          trailing={<Button label="Open settings" variant="secondary" size="sm" onPress={() => NotchIsland.openNotificationAccessSettings()} />}
        />
      </Group>

      <Group title="Widgets" footer="Widgets show in the order listed, top to bottom.">
        {order.map((w) => {
          const on = shown.includes(w);
          const position = shown.indexOf(w);
          return (
            <Row
              key={w}
              title={WIDGET_NAMES[w]}
              subtitle={on ? 'Shown' : 'Hidden'}
              trailing={
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {on && (
                    <>
                      <Button label="Up" variant="secondary" size="sm" disabled={position <= 0} onPress={() => shift(w, -1)} accessibilityHint={`Move ${WIDGET_NAMES[w]} up`} />
                      <Button label="Down" variant="secondary" size="sm" disabled={position >= shown.length - 1} onPress={() => shift(w, 1)} accessibilityHint={`Move ${WIDGET_NAMES[w]} down`} />
                    </>
                  )}
                  <Button label={on ? 'Hide' : 'Show'} variant={on ? 'secondary' : 'primary'} size="sm" onPress={() => toggle(w)} />
                </View>
              }
            />
          );
        })}
      </Group>
    </>
  );
}
