import React from 'react';
import { View } from 'react-native';
import { Button, Group, Header, Notice, Row, Screen, Text, space } from '@apps-hub/ui';
import { NOT_A_MEDICAL_DEVICE, summaryLine } from './vitals.ts';
import { useHardwareBack } from './useHardwareBack.ts';
import { useVitals } from './useVitals.ts';

// The Health section: one row per area.
export function HealthScreen({ onBack, onOpenVitals, onOpenMedicines, onOpenJournal, onOpenDoctor }: { onBack: () => void; onOpenVitals: () => void; onOpenMedicines: () => void; onOpenJournal: () => void; onOpenDoctor: () => void }) {
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
        <Row title="Medicines" subtitle="Reminders, today's doses and how many you took" onPress={onOpenMedicines} />
        <Row title="Journal" subtitle="How you feel and what you notice" onPress={onOpenJournal} />
        <Row title="Doctor summary" subtitle="A short written summary you can bring to a visit. You read the text before anything is sent." onPress={onOpenDoctor} />
      </Group>
      <Text variant="meta" tone="muted">{NOT_A_MEDICAL_DEVICE}</Text>
    </Screen>
  );
}
