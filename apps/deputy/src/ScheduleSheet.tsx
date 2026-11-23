import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Notice, Segmented, Sheet, space } from '@apps-hub/ui';
import DeputyAgent, { type Schedule } from 'deputy-agent';
import { DAYS, daysFor, formatTime, parseTime, presetOf, toggleDay, type Preset } from './repeat';

const PRESETS: ReadonlyArray<{ key: Preset; label: string }> = [
  { key: 'daily', label: 'Every day' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'days', label: 'Choose days' },
];

/** `draft` prefills a new repeating task, such as one made from a past run. */
export function ScheduleSheet({ schedule, draft, onClose, onSaved }: { schedule: Schedule | null; draft?: { name: string; task: string }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(schedule?.name ?? draft?.name ?? '');
  const [task, setTask] = useState(schedule?.task ?? draft?.task ?? '');
  const [time, setTime] = useState(schedule ? formatTime(schedule.hour, schedule.minute) : '08:00');
  const [days, setDays] = useState<number[]>(schedule?.days ?? [1, 2, 3, 4, 5, 6, 7]);
  const [preset, setPreset] = useState<Preset>(presetOf(days));
  const [error, setError] = useState<string | null>(null);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    setDays(daysFor(p, days));
  };

  const save = () => {
    const t = parseTime(time);
    if (!t) return setError('Type a time such as 08:00 or 21:30.');
    const r = DeputyAgent.saveSchedule({ id: schedule?.id ?? null, name, task, hour: t.hour, minute: t.minute, days, enabled: schedule?.enabled ?? true });
    if (r.error) return setError(r.error);
    onSaved();
    onClose();
  };

  return (
    <Sheet visible onClose={onClose} title={schedule ? 'Edit repeating task' : 'New repeating task'} doneLabel="Save" onDone={save}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Morning summary" />
      <Field label="What should Deputy do?" value={task} onChangeText={setTask} placeholder="Summarise my unread email" multiline />
      <Field label="Time" value={time} onChangeText={setTime} placeholder="08:00" keyboardType="numbers-and-punctuation" hint="24-hour time, such as 07:30 or 18:00." />
      <Segmented options={PRESETS} value={preset} onChange={pickPreset} accessibilityLabel="Which days" />
      {preset === 'days' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {DAYS.map((d) => (
            <Button
              key={d.n}
              label={d.short}
              size="sm"
              variant={days.includes(d.n) ? 'primary' : 'secondary'}
              accessibilityLabel={`${d.plural}, ${days.includes(d.n) ? 'on' : 'off'}`}
              onPress={() => setDays(toggleDay(days, d.n))}
            />
          ))}
        </View>
      )}
      <Notice tone="neutral" title="Deputy will ask you before it pays or sends anything">
        It stops and waits for your OK, as when you start a task yourself. If you don't answer within five minutes, it stops without doing that step.
      </Notice>
      {error && (
        <Notice tone="danger" title="Not saved">
          {error}
        </Notice>
      )}
    </Sheet>
  );
}
