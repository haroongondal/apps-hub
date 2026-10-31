import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { Button, Field, Group, Notice, Pill, Readout, Row, Text, space, useTheme, type Tone } from '@apps-hub/ui';
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
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  useEffect(() => setRun(DeputyAgent.getRun()), [state]);
  useEffect(() => {
    const sub = DeputyAgent.addListener('onRunEvent', () => setRun(DeputyAgent.getRun()));
    return () => sub.remove();
  }, []);

  const start = (text: string) => {
    const { error } = DeputyAgent.startRun(text.trim());
    setError(error);
    setRun(DeputyAgent.getRun());
    refresh();
  };

  // The speech dialog closes when the owner stops talking, so the run starts straight from what it heard.
  const speak = async () => {
    setListening(true);
    setSpeechError(null);
    try {
      const heard = await DeputyAgent.listen('What should Deputy do?');
      if (heard?.trim()) {
        setTask(heard);
        start(heard);
      }
    } catch (e) {
      setSpeechError(e instanceof Error ? e.message : String(e));
    } finally {
      setListening(false);
    }
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
          <MicButton onPress={speak} listening={listening} disabled={!canRun(state)} error={speechError} />
          <Field label="Or type it" value={task} onChangeText={setTask} placeholder="Open the clock app and tell me my next alarm" multiline />
          <Button label="Run" onPress={() => start(task)} disabled={!canRun(state) || task.trim() === ''} block />
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
          {steps.map((s, i) => (s.type === 'step' ? <StepRow key={i} step={s} /> : null))}
        </Group>
      )}
    </>
  );
}

const MIC = 112;

function MicButton({ onPress, listening, disabled, error }: { onPress: () => void; listening: boolean; disabled: boolean; error: string | null }) {
  const { c } = useTheme();
  const off = disabled || listening;
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
      <Pressable
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel="Speak a task"
        accessibilityHint="Deputy starts the task as soon as you stop talking"
        accessibilityState={{ disabled: off, busy: listening }}
        style={({ pressed }) => ({
          width: MIC,
          height: MIC,
          borderRadius: MIC / 2,
          backgroundColor: c.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: off ? 0.5 : pressed ? 0.8 : 1,
          transform: [{ scale: pressed && !off ? 0.96 : 1 }],
        })}
      >
        {/* Drawn from Views: the app has no icon set, and emoji icons are off-limits. */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 20, height: 32, borderRadius: 10, backgroundColor: c.onAccent }} />
          <View style={{ width: 32, height: 16, marginTop: -8, borderWidth: 3, borderTopWidth: 0, borderColor: c.onAccent, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }} />
          <View style={{ width: 3, height: 6, backgroundColor: c.onAccent }} />
          <View style={{ width: 16, height: 3, borderRadius: 1.5, backgroundColor: c.onAccent }} />
        </View>
      </Pressable>
      <Text tone={error ? 'danger' : 'muted'} align="center">
        {error ?? (listening ? 'Listening…' : 'Tap and say the task. It starts when you stop talking.')}
      </Text>
    </View>
  );
}

export function StepRow({ step: s }: { step: Extract<RunEvent, { type: 'step' }> }) {
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const timing = s.modelMs > 0 ? ` (model ${secs(s.modelMs)}, action ${secs(s.actMs)})` : '';
  return <Row title={`${s.n}. ${s.action}`} subtitle={`${s.app}: ${s.result}${timing}`} trailing={<Pill {...VERDICTS[s.verdict]} />} />;
}

function GateCard({ gate, onAnswered }: { gate: Gate; onAnswered: () => void }) {
  const [text, setText] = useState('');
  const [stale, setStale] = useState(false);
  const answer = (approve: boolean, reply: string | null) => {
    // Taps reach Send with the keyboard up; the run's one Back would only close it and Deputy would stay in front.
    Keyboard.dismiss();
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
