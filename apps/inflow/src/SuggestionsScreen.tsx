import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, Row, Screen, Text, space } from '@apps-hub/ui';
import type { State, SuggestionRow } from '@apps-hub/autopilot-contract';
import InflowCore, { addSuggestionsListener } from 'inflow-core';
import { dueLabel } from './ai.ts';
import { groupByState, kindLabel } from './autopilot.ts';
import { LOAD_ERROR } from './messages.ts';
import { useHardwareBack } from './useHardwareBack.ts';

const RUN_ERROR = "Inflow couldn't start that. Close and reopen the app, then try again.";
const SKIP_ERROR = "Inflow couldn't skip that. Close and reopen the app, then try again.";
const STARTED = 'Deputy is starting.';
const REPLY_NOTE = 'Deputy will ask you before it sends anything.';
const STATE_LABEL: Record<State, string> = { waiting: 'Waiting', started: 'Started', done: 'Done', skipped: 'Skipped', expired: 'Expired' };

export interface ActionMessage {
  tone: 'neutral' | 'danger';
  text: string;
}

// Run and Skip for any list of suggestions; onChanged reloads the list after either one.
export function useSuggestionActions(onChanged: () => void): { run: (id: number) => void; skip: (id: number) => void; message: ActionMessage | null } {
  const [message, setMessage] = useState<ActionMessage | null>(null);
  const run = (id: number) => {
    try {
      // null: Deputy was started. Text: why it could not be, written for the owner.
      const reason = InflowCore.runSuggestion(id);
      setMessage(reason === null ? { tone: 'neutral', text: STARTED } : { tone: 'danger', text: reason });
    } catch {
      setMessage({ tone: 'danger', text: RUN_ERROR });
    }
    onChanged();
  };
  const skip = (id: number) => {
    try {
      InflowCore.skipSuggestion(id);
      setMessage(null);
    } catch {
      setMessage({ tone: 'danger', text: SKIP_ERROR });
    }
    onChanged();
  };
  return { run, skip, message };
}

export function SuggestionRowItem({ row, now, onRun, onSkip }: { row: SuggestionRow; now: number; onRun: (id: number) => void; onSkip: (id: number) => void }) {
  const waiting = row.state === 'waiting';
  const when = row.due_at === null ? '' : ` · ${dueLabel(row.due_at, now)}`;
  return (
    <Row
      title={row.title}
      subtitle={`${kindLabel(row.kind)}${when}`}
      trailing={
        waiting ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Button label="Run" size="sm" onPress={() => onRun(row.id)} accessibilityHint={`Run: ${row.title}`} />
            <Button label="Skip" variant="ghost" size="sm" onPress={() => onSkip(row.id)} accessibilityHint={`Skip: ${row.title}`} />
          </View>
        ) : (
          <Pill label={STATE_LABEL[row.state]} />
        )
      }
    >
      {waiting && row.kind === 'reply' && (
        <Text variant="caption" tone="muted">
          {REPLY_NOTE}
        </Text>
      )}
    </Row>
  );
}

// Everything Autopilot suggested: what is waiting, and what was run, skipped or ran out.
export function SuggestionsScreen({ onBack }: { onBack: () => void }) {
  useHardwareBack(onBack);
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setRows(InflowCore.suggestions(['waiting', 'started', 'done', 'skipped', 'expired'], 200));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    load();
    const sub = addSuggestionsListener(load);
    return () => sub.remove();
  }, [load]);
  const { run, skip, message } = useSuggestionActions(load);

  const { waiting, history } = groupByState(rows);
  const now = Date.now();
  return (
    <Screen scroll>
      <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
      <Header title="Suggestions" />
      {error !== null && <Notice tone="danger">{error}</Notice>}
      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
      {loaded && error === null && rows.length === 0 && <Empty title="No suggestions yet" body="Inflow suggests replies, bills, events and payments to check as messages arrive." />}
      {waiting.length > 0 && (
        <Group title="Waiting">
          {waiting.map((r) => (
            <SuggestionRowItem key={r.id} row={r} now={now} onRun={run} onSkip={skip} />
          ))}
        </Group>
      )}
      {history.length > 0 && (
        <Group title="History">
          {history.map((r) => (
            <SuggestionRowItem key={r.id} row={r} now={now} onRun={run} onSkip={skip} />
          ))}
        </Group>
      )}
    </Screen>
  );
}
