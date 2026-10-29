import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Group, Notice, Pill, Row, Sheet, Text, type Tone } from '@apps-hub/ui';
import DeputyAgent, { type RunSummary, type ServiceState } from 'deputy-agent';
import { StepRow } from './RunPanel';

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

  useEffect(() => setRuns(DeputyAgent.listRuns(LIMIT)), [state]);

  const clear = () =>
    Alert.alert('Clear history?', "Deputy deletes the record of every past task. Today's spending still counts toward the daily limit.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          DeputyAgent.clearHistory();
          refresh();
        },
      },
    ]);

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
            trailing={<Pill {...STATUS[r.status]} />}
            onPress={() => setOpen(r)}
            accessibilityHint="Shows what Deputy did"
          />
        ))}
      </Group>
      {open && <RunSheet run={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function RunSheet({ run, onClose }: { run: RunSummary; onClose: () => void }) {
  const [events] = useState(() => DeputyAgent.getRunLog(run.runId));
  return (
    <Sheet visible onClose={onClose} title="Past task">
      <Text>{run.task}</Text>
      <Notice tone={STATUS[run.status].tone} title={STATUS[run.status].label}>
        {run.summary ?? `${run.steps} steps, $${run.costUsd.toFixed(4)}`}
      </Notice>
      <Group>{events.map((e, i) => (e.type === 'step' ? <StepRow key={i} step={e} /> : null))}</Group>
    </Sheet>
  );
}
