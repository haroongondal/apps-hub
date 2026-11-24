import React from 'react';
import { View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Readout, Row, Screen, Text, space } from '@apps-hub/ui';
import type { HealthDay } from 'inflow-core';
import { Bar } from './Bar.tsx';
import { useHardwareBack } from './useHardwareBack.ts';
import { useVitals } from './useVitals.ts';
import { NOT_A_MEDICAL_DEVICE, average, barFraction, dayLabel, formatMetric, partialAccessNote, vitalsCopy, type Metric } from './vitals.ts';

interface Block {
  metric: Metric;
  title: string;
  todayLabel: string;
  unit?: string;
  none: string;
  averageLabel: string;
}

const BLOCKS: Block[] = [
  { metric: 'steps', title: 'Steps', todayLabel: 'Steps today', unit: 'steps', none: 'No steps saved for today yet.', averageLabel: 'Average a day' },
  { metric: 'sleepMinutes', title: 'Sleep', todayLabel: 'Sleep last night', none: 'No sleep saved for last night.', averageLabel: 'Average a night' },
  { metric: 'hrAvg', title: 'Heart rate', todayLabel: 'Average heart rate today', none: 'No heart rate saved for today yet.', averageLabel: 'Average over these days' },
];

function MetricBlock({ block, series, now }: { block: Block; series: HealthDay[]; now: number }) {
  const { metric } = block;
  const today = series[series.length - 1]?.[metric] ?? null;
  const avg = average(series, metric);
  const value = today === null ? null : formatMetric(metric, today);
  return (
    <Group title={block.title} footer={avg === null ? undefined : `${block.averageLabel}: ${formatMetric(metric, avg)}`}>
      <Row title={value === null ? <Text tone="muted">{block.none}</Text> : <Readout value={value} unit={block.unit} label={block.todayLabel} />} />
      {series
        .slice()
        .reverse()
        .map((d) => {
          const v = d[metric];
          const text = v === null ? 'No data' : formatMetric(metric, v);
          const label = dayLabel(d.day, now);
          return (
            <Row key={d.day} accessibilityLabel={`${label}: ${text}`} title={label} trailing={<Text variant="data" tone={v === null ? 'muted' : 'text'}>{text}</Text>}>
              <Bar fraction={barFraction(v, series, metric)} />
            </Row>
          );
        })}
    </Group>
  );
}

// Steps, sleep and heart rate for the last 7 days, from what Health Connect holds. Shown only while unlocked (the whole app sits behind the lock).
export function VitalsScreen({ onBack }: { onBack: () => void }) {
  useHardwareBack(onBack);
  const v = useVitals();
  const copy = v.state === null || v.state === 'data' ? null : vitalsCopy(v.state);
  const partial = v.status === null ? null : partialAccessNote(v.status);
  const canRefresh = v.state === 'data' || v.state === 'empty';
  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header
          title="Steps, sleep and heart rate"
          trailing={canRefresh ? <Button label="Refresh" variant="secondary" size="sm" busy={v.busy} onPress={v.refresh} /> : undefined}
        />
      </View>
      {v.message !== null && <Notice tone="danger">{v.message}</Notice>}
      {partial !== null && v.state !== 'not-allowed' && (
        <Notice tone="warn" action={<Button label="Allow access" variant="secondary" size="sm" onPress={v.allow} />}>
          {partial}
        </Notice>
      )}
      {copy !== null && (
        <Empty title={copy.title} body={copy.body} action={copy.action === 'allow' ? <Button label="Allow access" onPress={v.allow} busy={v.busy} /> : undefined} />
      )}
      {v.state === 'data' && BLOCKS.map((b) => <MetricBlock key={b.metric} block={b} series={v.series} now={v.now} />)}
      <Text variant="meta" tone="muted">{NOT_A_MEDICAL_DEVICE}</Text>
    </Screen>
  );
}
