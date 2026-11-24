import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Notice, Pill, RecordMenu, Row, Sheet, Text, confirmAction, space, type Tone } from '@apps-hub/ui';
import DeputyAgent, { type RunSummary, type ServiceState } from 'deputy-agent';
import { StepRow } from './RunPanel';
import { ScheduleSheet } from './ScheduleSheet';
import { TaskSheet } from './SavedTasks';

const STATUS: Record<RunSummary['status'], { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'accent' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  declined: { label: 'You said no', tone: 'neutral' },
  capped: { label: 'Hit a limit', tone: 'warn' },
  interrupted: { label: 'Cut off', tone: 'warn' },
};

const LIMIT = 50;

export function History({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [open, setOpen] = useState<RunSummary | null>(null);
  const [saving, setSaving] = useState<RunSummary | null>(null);
  const [repeating, setRepeating] = useState<RunSummary | null>(null);

  useEffect(() => setRuns(DeputyAgent.listRuns(LIMIT)), [state]);

  const clear = () =>
    confirmAction({
      title: 'Clear history?',
      message: "Deputy deletes the record of every past task. Today's spending still counts toward the daily limit.",
      confirmLabel: 'Clear',
      onConfirm: () => {
        DeputyAgent.clearHistory();
        refresh();
      },
    });

  const removeRun = (r: RunSummary) => {
    DeputyAgent.deleteRun(r.runId);
    setRuns(DeputyAgent.listRuns(LIMIT));
  };

  const saveOpen = () => {
    setSaving(open);
    setOpen(null);
  };

  const repeatOpen = () => {
    setRepeating(open);
    setOpen(null);
  };

  return (
    <>
      <Group
        title="History"
        trailing={runs.length > 0 ? <Button label="Clear" variant="ghost" size="sm" onPress={clear} /> : undefined}
        footer={
          runs.length === 0
            ? 'Tasks you run appear here.'
            : `${runs.length === LIMIT ? `The newest ${LIMIT} shown. ` : ''}Deputy keeps 30 days, up to 200 tasks, and never saves screens.`
        }
      >
        {runs.map((r) => (
          <Row
            key={r.runId}
            title={r.task}
            subtitle={`${new Date(r.startedAt).toLocaleString()}, ${r.steps} ${r.steps === 1 ? 'step' : 'steps'}, $${r.costUsd.toFixed(4)}`}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Pill {...STATUS[r.status]} />
                {r.status !== 'running' && (
                  <RecordMenu
                    title="Past task"
                    accessibilityLabel={`More actions for ${r.task}`}
                    actions={[
                      { label: 'Save as task', onPress: () => setSaving(r) },
                      { label: 'Repeat this task', onPress: () => setRepeating(r) },
                      {
                        label: 'Delete',
                        onPress: () => removeRun(r),
                        destructive: true,
                        confirmTitle: 'Delete this past task?',
                        confirmMessage: "Deputy forgets what it did. Today's spending still counts toward the daily limit.",
                      },
                    ]}
                  />
                )}
              </View>
            }
            onPress={() => setOpen(r)}
            accessibilityHint="Shows what Deputy did"
          />
        ))}
      </Group>
      {open && <RunSheet run={open} onClose={() => setOpen(null)} onSave={saveOpen} onRepeat={repeatOpen} />}
      {saving && <TaskSheet task={null} draft={{ name: saving.task.slice(0, 60), task: saving.task }} onClose={() => setSaving(null)} onSaved={refresh} />}
      {repeating && <ScheduleSheet schedule={null} draft={{ name: repeating.task.slice(0, 60), task: repeating.task }} onClose={() => setRepeating(null)} onSaved={refresh} />}
    </>
  );
}

export function RunSheet({ run, onClose, onSave, onRepeat }: { run: RunSummary; onClose: () => void; onSave?: () => void; onRepeat?: () => void }) {
  const [events] = useState(() => DeputyAgent.getRunLog(run.runId));
  return (
    <Sheet visible onClose={onClose} title="Past task">
      <Text>{run.task}</Text>
      <Notice tone={STATUS[run.status].tone} title={STATUS[run.status].label}>
        {run.summary ?? `${run.steps} steps, $${run.costUsd.toFixed(4)}`}
      </Notice>
      <Group>{events.map((e, i) => (e.type === 'step' ? <StepRow key={i} step={e} /> : null))}</Group>
      {onSave && <Button label="Save as task" variant="secondary" onPress={onSave} block />}
      {onRepeat && run.status !== 'running' && <Button label="Repeat this task" variant="secondary" onPress={onRepeat} block />}
    </Sheet>
  );
}
