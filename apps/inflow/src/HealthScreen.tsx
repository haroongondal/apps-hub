import React from 'react';
import { View } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Text, space } from '@apps-hub/ui';
import { NOT_A_MEDICAL_DEVICE, summaryLine } from './vitals.ts';
import { useHardwareBack } from './useHardwareBack.ts';
import { useVitals } from './useVitals.ts';

// The Health section: one row per area. Later areas (medicines, journal, doctor summary) add rows here.
export function HealthScreen({ onBack, onOpenVitals }: { onBack: () => void; onOpenVitals: () => void }) {
  useHardwareBack(onBack);
  const v = useVitals();
  const today = v.series[v.series.length - 1];
  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="Health" />
      </View>
      {v.message !== null && <Notice tone="danger">{v.message}</Notice>}
      <Group>
        <Row title="Steps, sleep and heart rate" subtitle={v.state === null ? undefined : summaryLine(v.state, today)} onPress={onOpenVitals} />
      </Group>
      <Text variant="meta" tone="muted">{NOT_A_MEDICAL_DEVICE}</Text>
    </Screen>
  );
}
