import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Pill, Readout, Row, Text, space, type Tone } from '@apps-hub/ui';
import DeputyAgent, { type Gate, type RunEvent, type RunSnapshot, type RunStatus, type ServiceState } from 'deputy-agent';
import { canRun } from './setup';

const VERDICTS: Record<Extract<RunEvent, { type: 'step' }>['verdict'], { label: string; tone: Tone }> = {
  allow: { label: 'Allowed', tone: 'neutral' },
  confirm: { label: 'Asked you', tone: 'warn' },
  deny: { label: 'Refused', tone: 'danger' },
  none: { label: 'No action', tone: 'neutral' },
  question: { label: 'Question', tone: 'accent' },
};

const ENDINGS: Record<RunStatus, { title: string; tone: Tone }> = {
  done: { title: 'Task done', tone: 'ok' },
  failed: { title: 'Task failed', tone: 'danger' },
  stopped: { title: 'You stopped the task', tone: 'neutral' },
  declined: { title: 'You said no, so Deputy stopped', tone: 'neutral' },
  capped: { title: 'Deputy hit a limit', tone: 'warn' },
  interrupted: { title: 'The task was cut off', tone: 'warn' },
};

export function RunPanel({ state, refresh }: { state: ServiceState; refresh: () => void }) {
  const [task, setTask] = useState('');
  const [run, setRun] = useState<RunSnapshot>(() => DeputyAgent.getRun());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRun(DeputyAgent.getRun()), [state]);
  useEffect(() => {
    const sub = DeputyAgent.addListener('onRunEvent', (e) => {
      setRun(DeputyAgent.getRun());
      if (e.type === 'finished') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const start = () => {
    const { error } = DeputyAgent.startRun(task.trim());
    setError(error);
    setRun(DeputyAgent.getRun());
    refresh();
  };

  const steps = run.events.filter((e) => e.type === 'step');
  const end = run.events.find((e) => e.type === 'finished');
  const cost = run.events.reduce((usd, e) => ('costUsd' in e ? e.costUsd : usd), 0);

  return (
    <>
      <Group
        title="Task"
        footer={state.runActive ? 'Deputy is doing a task. Stop it to start another.' : canRun(state) ? undefined : 'Finish the setup rows marked To do first.'}
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field label="What should Deputy do?" value={task} onChangeText={setTask} placeholder="Open the clock app and tell me my next alarm" multiline />
          <Button label="Run" onPress={start} disabled={!canRun(state) || task.trim() === ''} block />
          {error && (
            <Notice tone="danger" title="Deputy didn't start">
              {error}
            </Notice>
          )}
        </View>
      </Group>
      {run.runId && (
        <Group title={run.active ? 'Current task' : 'Last task'}>
          <View style={{ padding: space.lg, gap: space.md }}>
            {run.gate && <GateCard key={run.gate.id} gate={run.gate} onAnswered={() => setRun(DeputyAgent.getRun())} />}
            {end?.type === 'finished' && (
              <Notice tone={ENDINGS[end.status].tone} title={ENDINGS[end.status].title}>
                {end.summary ?? ''}
              </Notice>
            )}
            <Readout value={`$${cost.toFixed(4)}`} label={run.active ? 'Cost so far' : 'Cost'} />
            {run.active && <Button label="Stop" variant="danger" onPress={() => DeputyAgent.stopRun()} block />}
          </View>
          {steps.map((s, i) =>
            s.type === 'step' ? (
              <Row key={i} title={`${s.n}. ${s.action}`} subtitle={`${s.app}: ${s.result}`} trailing={<Pill {...VERDICTS[s.verdict]} />} />
            ) : null,
          )}
        </Group>
      )}
    </>
  );
}

function GateCard({ gate, onAnswered }: { gate: Gate; onAnswered: () => void }) {
  const [text, setText] = useState('');
  const [stale, setStale] = useState(false);
  const answer = (approve: boolean, reply: string | null) => {
    setStale(!DeputyAgent.resolveGate(gate.id, approve, reply));
    onAnswered();
  };

  if (gate.kind === 'question') {
    return (
      <Notice tone="accent" title="Deputy has a question">
        <View style={{ gap: space.sm }}>
          <Text>{gate.action}</Text>
          {gate.options.map((o) => (
            <Button key={o} label={o} variant="secondary" onPress={() => answer(false, o)} block />
          ))}
          <Field label="Your answer" value={text} onChangeText={setText} />
          <Button label="Send answer" onPress={() => answer(false, text.trim())} disabled={text.trim() === ''} block />
          {stale && <Text tone="muted">That question has expired or was already answered.</Text>}
        </View>
      </Notice>
    );
  }
  return (
    <Notice tone="warn" title="Deputy needs your OK">
      <View style={{ gap: space.sm }}>
        <Text>{`${gate.action}${gate.target ? ` "${gate.target}"` : ''} in ${gate.app}`}</Text>
        {gate.draftText && <Text>{`Text: ${gate.draftText}`}</Text>}
        {gate.reason && <Text tone="muted">{`Deputy says: ${gate.reason}`}</Text>}
        <Button label="Approve" onPress={() => answer(true, null)} block />
        <Button label="Deny" variant="secondary" onPress={() => answer(false, null)} block />
        {stale && <Text tone="muted">That request has expired or was already answered.</Text>}
      </View>
    </Notice>
  );
}
