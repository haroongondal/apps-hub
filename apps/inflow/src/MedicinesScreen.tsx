import React, { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, RecordMenu, Row, Screen, Segmented, Text, space } from '@apps-hub/ui';
import InflowCore, { type AdherenceReport, type DoseRow, type Medicine } from 'inflow-core';
import { MedicineSheet, type MedicineTarget } from './MedicineSheet.tsx';
import { beginPermissionPrompt, endPermissionPrompt } from './lockGrace.ts';
import { SAVE_ERROR } from './messages.ts';
import { useHardwareBack } from './useHardwareBack.ts';
import { DELETE_MEDICINE_MESSAGE, LOAD_FAILED, MEDICAL_LINE, REMINDERS_OFF, STOP_MEDICINE_MESSAGE, adherenceLines, clockTime, doseView, medicineSubtitle, splitMedicines, todayKey } from './medicines.ts';

const PERIODS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
] as const;

const REFRESH_MS = 30_000;

// Medicines with today's doses and how many were taken. Reloads when the app returns and every 30 seconds, because a notification button can change a dose with no event.
export function MedicinesScreen({ onBack }: { onBack: () => void }) {
  useHardwareBack(onBack);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [doses, setDoses] = useState<DoseRow[]>([]);
  const [report, setReport] = useState<AdherenceReport | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<MedicineTarget>(null);

  const load = useCallback(() => {
    try {
      const at = Date.now();
      const day = todayKey(at);
      setMedicines(InflowCore.medicines());
      setDoses(InflowCore.dosesBetween(day, day));
      setReport(InflowCore.adherence(period));
      setAllowed(InflowCore.medicineRemindersAllowed());
      setNow(at);
      setMessage(null);
    } catch {
      setMessage(LOAD_FAILED);
    }
  }, [period]);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [load]);

  const change = (apply: () => void) => {
    try {
      apply();
    } catch {
      setMessage(SAVE_ERROR);
      return;
    }
    load();
  };
  const mark = (d: DoseRow, status: 'taken' | 'skipped') => {
    try {
      setMessage(InflowCore.markDose(d.medicineId, d.dueAt, status));
    } catch {
      setMessage(SAVE_ERROR);
    }
    load();
  };
  const askNotifications = async () => {
    beginPermissionPrompt(Date.now());
    try {
      await InflowCore.askNotifications();
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      endPermissionPrompt();
    }
    load();
  };

  const { active, stopped } = splitMedicines(medicines);
  const names = new Map(medicines.map((m) => [m.id, m]));
  const lines = report === null ? [] : adherenceLines(report, medicines);
  const medicineRow = (m: Medicine) => (
    <Row
      key={m.id}
      title={m.name}
      subtitle={medicineSubtitle(m)}
      trailing={
        <RecordMenu
          title={m.name}
          actions={[
            ...(m.active ? [{ label: 'Edit', onPress: () => setEditing(m) }, { label: 'Stop', onPress: () => change(() => InflowCore.stopMedicine(m.id)), destructive: true, confirmTitle: `Stop ${m.name}?`, confirmMessage: STOP_MEDICINE_MESSAGE, confirmLabel: 'Stop' }] : []),
            { label: 'Delete', onPress: () => change(() => InflowCore.deleteMedicine(m.id)), destructive: true, confirmTitle: `Delete ${m.name}?`, confirmMessage: DELETE_MEDICINE_MESSAGE, confirmLabel: 'Delete' },
          ]}
        />
      }
    />
  );

  return (
    <Screen scroll>
      <View style={{ gap: space.sm }}>
        <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
        <Header title="Medicines" trailing={<Button label="Add" variant="secondary" size="sm" onPress={() => setEditing('new')} />} />
      </View>
      {message !== null && <Notice tone="danger">{message}</Notice>}
      {!allowed && (
        <Notice tone="warn" action={<Button label="Allow notifications" variant="secondary" size="sm" onPress={askNotifications} />}>
          {REMINDERS_OFF}
        </Notice>
      )}
      <Group title="Today" footer={doses.length === 0 ? undefined : 'Mark a dose from an hour before it is due.'}>
        {doses.length === 0 ? (
          <Row title={<Text tone="muted">No doses today.</Text>} />
        ) : (
          doses.map((d) => {
            const view = doseView(d, now);
            const med = names.get(d.medicineId);
            return (
              <Row key={`${d.medicineId}-${d.dueAt}`} title={med?.name ?? 'A removed medicine'} subtitle={`${clockTime(d.dueAt)}. ${med?.dose ?? ''}`} trailing={<Pill label={view.label} tone={view.tone} />}>
                {view.actions.length > 0 && (
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    {view.actions.includes('taken') && <Button label="Taken" size="sm" accessibilityLabel={`Mark ${med?.name ?? 'dose'} as taken`} onPress={() => mark(d, 'taken')} />}
                    {view.actions.includes('skipped') && <Button label="Skip" size="sm" variant="secondary" accessibilityLabel={`Skip ${med?.name ?? 'dose'}`} onPress={() => mark(d, 'skipped')} />}
                  </View>
                )}
              </Row>
            );
          })
        )}
      </Group>
      <Group title="Doses taken" footer="Counts only the doses that have come due.">
        <Row title={<Segmented options={PERIODS} value={period} onChange={setPeriod} accessibilityLabel="Period" />} />
        {lines.length === 0 ? (
          <Row title={<Text tone="muted">Nothing to count yet.</Text>} />
        ) : (
          lines.map((l) => <Row key={l.key} title={l.name} subtitle={`${l.counts}. ${l.streak}.`} trailing={<Text variant="data">{l.percent}</Text>} />)
        )}
      </Group>
      <Group title="Medicines">
        {active.length === 0 ? <Row title={<Text tone="muted">No medicines yet. Tap Add to set one up.</Text>} /> : active.map(medicineRow)}
      </Group>
      {stopped.length > 0 && <Group title="Stopped">{stopped.map(medicineRow)}</Group>}
      <Text variant="meta" tone="muted">{MEDICAL_LINE}</Text>
      <MedicineSheet
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </Screen>
  );
}
