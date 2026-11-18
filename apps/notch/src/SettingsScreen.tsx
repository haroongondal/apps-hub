import React from 'react';
import { Pressable, View } from 'react-native';
import { Button, Group, Row, Segmented, useTheme } from '@apps-hub/ui';
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
  type NotchSettings,
  type WidgetId,
} from './settings';

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
// Phase 1 ships these two; the others stay listed, unavailable, until phase 2.
const READY: WidgetId[] = ['clock', 'battery'];

export function SettingsScreen({ value, onChange }: { value: NotchSettings; onChange: (next: NotchSettings) => void }) {
  const { c } = useTheme();
  const set = (patch: Partial<NotchSettings>) => onChange({ ...value, ...patch });
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

      <Group title="Widgets" footer="Widgets show in the order listed, top to bottom.">
        {order.map((w) => {
          const on = shown.includes(w);
          const ready = READY.includes(w);
          const position = shown.indexOf(w);
          return (
            <Row
              key={w}
              title={WIDGET_NAMES[w]}
              subtitle={ready ? (on ? 'Shown' : 'Hidden') : 'Coming soon'}
              trailing={
                ready ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {on && (
                      <>
                        <Button label="Up" variant="secondary" size="sm" disabled={position <= 0} onPress={() => shift(w, -1)} accessibilityHint={`Move ${WIDGET_NAMES[w]} up`} />
                        <Button label="Down" variant="secondary" size="sm" disabled={position >= shown.length - 1} onPress={() => shift(w, 1)} accessibilityHint={`Move ${WIDGET_NAMES[w]} down`} />
                      </>
                    )}
                    <Button label={on ? 'Hide' : 'Show'} variant={on ? 'secondary' : 'primary'} size="sm" onPress={() => toggle(w)} />
                  </View>
                ) : undefined
              }
            />
          );
        })}
      </Group>
    </>
  );
}
