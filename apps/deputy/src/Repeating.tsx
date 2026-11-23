import React, { useCallback, useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, RecordMenu, Row, Screen, Sheet, Text, editDeleteActions, space, useTheme, type Tone } from '@apps-hub/ui';
import DeputyAgent, { type RunSummary, type Schedule, type ScheduleOutcome, type ServiceState } from 'deputy-agent';
import { RunSheet } from './History';
import { describeWhen } from './repeat';
import { ScheduleSheet } from './ScheduleSheet';

const OUTCOME: Record<ScheduleOutcome, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'accent' },
  waiting: { label: 'Waiting for your OK', tone: 'warn' },
  finished: { label: 'Done', tone: 'ok' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'warn' },
};

const when = (ms: number) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Repeating({ state }: { state: ServiceState }) {
  const { c } = useTheme();
  const [list, setList] = useState<Schedule[]>(() => DeputyAgent.listSchedules());
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [open, setOpen] = useState<Schedule | null>(null);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => setList(DeputyAgent.listSchedules()), []);
  useEffect(reload, [state, reload]);

  const toggle = (s: Schedule, enabled: boolean) => {
    setError(DeputyAgent.saveSchedule({ ...s, enabled }).error);
    reload();
  };

  const remove = (s: Schedule) => {
    DeputyAgent.deleteSchedule(s.id);
    reload();
  };

  return (
    <Screen scroll>
      <Header title="Repeating tasks" subtitle="Deputy starts these by itself at the time you pick, and asks you before it pays or sends anything." />
      {!state.notificationsAllowed && (
        <Notice tone="warn" title="Notifications are off">
          Turn them on in Setup. Without them Deputy can't ask for your OK or tell you when it skips a task.
        </Notice>
      )}
      <Group
        title="Repeating tasks"
        trailing={<Button label="New" variant="ghost" size="sm" onPress={() => setEditing('new')} />}
        footer={
          list.length === 0
            ? 'Save a task and pick the days and time Deputy should do it.'
            : "Deputy starts a task only while your phone is unlocked and it isn't busy. Otherwise it skips that time and tells you."
        }
      >
        {list.map((s) => (
          <Row
            key={s.id}
            title={s.name}
            subtitle={`${describeWhen(s)}\n${s.nextRunAt === null ? 'Switched off' : `Next: ${when(s.nextRunAt)}`}`}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Switch
                  value={s.enabled}
                  onValueChange={(v) => toggle(s, v)}
                  accessibilityLabel={`Repeat ${s.name}`}
                  trackColor={{ false: c.line, true: c.accent }}
                  thumbColor={s.enabled ? c.surface : c.muted}
                />
                <RecordMenu
                  title={s.name}
                  actions={[
                    { label: 'Past runs', onPress: () => setOpen(s) },
                    ...editDeleteActions({ onEdit: () => setEditing(s), onDelete: () => remove(s), noun: 'repeating task', name: s.name }),
                  ]}
                />
              </View>
            }
            onPress={() => setOpen(s)}
            accessibilityHint="Shows when Deputy did this task"
          />
        ))}
      </Group>
      {error && (
        <Notice tone="danger" title="Not changed">
          {error}
        </Notice>
      )}
      {editing && <ScheduleSheet schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {open && (
        <PastRuns
          schedule={open}
          onClose={() => setOpen(null)}
          onOpenRun={(r) => {
            setOpen(null);
            setRun(r);
          }}
        />
      )}
      {run && <RunSheet run={run} onClose={() => setRun(null)} />}
    </Screen>
  );
}

function PastRuns({ schedule, onClose, onOpenRun }: { schedule: Schedule; onClose: () => void; onOpenRun: (r: RunSummary) => void }) {
  const [runs] = useState(() => DeputyAgent.listScheduleRuns(schedule.id));
  const [kept] = useState(() => DeputyAgent.listRuns(200));
  return (
    <Sheet visible onClose={onClose} title={schedule.name}>
      <Text>{describeWhen(schedule)}</Text>
      <Group footer={runs.length === 0 ? "Deputy hasn't done this task yet." : 'Deputy keeps the last 30 times, for up to 30 days.'}>
        {runs.map((r, i) => {
          const past = r.runId ? kept.find((k) => k.runId === r.runId) : undefined;
          return (
            <Row
              key={`${r.at}-${i}`}
              title={when(r.at)}
              subtitle={r.summary || undefined}
              trailing={<Pill {...OUTCOME[r.outcome]} />}
              onPress={past ? () => onOpenRun(past) : undefined}
              accessibilityHint={past ? 'Shows what Deputy did' : undefined}
            />
          );
        })}
      </Group>
    </Sheet>
  );
}
