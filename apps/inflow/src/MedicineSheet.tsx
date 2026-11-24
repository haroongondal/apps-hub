import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Notice, Sheet, space } from '@apps-hub/ui';
import InflowCore, { type Medicine } from 'inflow-core';
import { Chips } from './Chips.tsx';
import { SAVE_ERROR } from './messages.ts';
import { DAY_CHIPS, MAX_TIMES, buildMedicine, emptyForm, formFromMedicine, type MedicineForm } from './medicines.ts';

// `Medicine` = edit it, 'new' = add one, null = closed.
export type MedicineTarget = Medicine | 'new' | null;

const DAY_OPTIONS = DAY_CHIPS.map((d) => ({ key: d.day, label: d.label, spoken: d.full }));

export function MedicineSheet({ target, onClose, onSaved }: { target: MedicineTarget; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<MedicineForm>(() => emptyForm(Date.now()));
  const [error, setError] = useState<string | null>(null);
  const editing = target !== null && target !== 'new' ? target : null;

  useEffect(() => {
    if (target === null) return;
    setForm(editing ? formFromMedicine(editing) : emptyForm(Date.now()));
    setError(null);
  }, [target === null ? null : editing?.id ?? 'new']);

  const set = (patch: Partial<MedicineForm>) => setForm((f) => ({ ...f, ...patch }));
  const setTime = (i: number, text: string) => set({ times: form.times.map((t, j) => (j === i ? text : t)) });
  const toggleDay = (day: number) => set({ days: form.days.includes(day) ? form.days.filter((d) => d !== day) : [...form.days, day] });

  const save = () => {
    const built = buildMedicine(editing?.id ?? null, form);
    if (typeof built === 'string') {
      setError(built);
      return;
    }
    try {
      const problem = InflowCore.saveMedicine(built);
      if (problem !== null) {
        setError(problem);
        return;
      }
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };

  return (
    <Sheet visible={target !== null} onClose={onClose} title={editing ? 'Edit medicine' : 'New medicine'} doneLabel="Save" onDone={save}>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Field label="Name" value={form.name} onChangeText={(name) => set({ name })} returnKeyType="next" autoCapitalize="words" />
      <Field label="Dose" hint="For example 1 tablet or 5 ml." value={form.dose} onChangeText={(dose) => set({ dose })} returnKeyType="next" autoCapitalize="none" />
      <View style={{ gap: space.md }}>
        {form.times.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label={`Time ${i + 1}`} hint={i === 0 ? 'Hours and minutes, like 08:30.' : undefined} value={t} onChangeText={(text) => setTime(i, text)} keyboardType="numbers-and-punctuation" autoCorrect={false} />
            </View>
            {form.times.length > 1 && <Button label="Remove" variant="ghost" size="sm" accessibilityLabel={`Remove time ${i + 1}`} onPress={() => set({ times: form.times.filter((_, j) => j !== i) })} />}
          </View>
        ))}
        {form.times.length < MAX_TIMES && <Button label="Add a time" variant="secondary" size="sm" onPress={() => set({ times: [...form.times, ''] })} />}
      </View>
      <Chips title="Days" options={DAY_OPTIONS} selected={form.days} onToggle={toggleDay} />
      <Field label="Start day" hint="Year-month-day, like 2026-11-20." value={form.startDay} onChangeText={(startDay) => set({ startDay })} autoCorrect={false} autoCapitalize="none" />
      <Field label="End day (optional)" hint="Leave empty to keep going." value={form.endDay} onChangeText={(endDay) => set({ endDay })} onSubmitEditing={save} returnKeyType="done" autoCorrect={false} autoCapitalize="none" />
    </Sheet>
  );
}
