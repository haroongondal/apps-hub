import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Group, Notice, Sheet, Text, space } from '@apps-hub/ui';
import DeputyAgent, { type ServiceState } from 'deputy-agent';
import { canRun } from './setup';

export interface SharedInput {
  id: string | null;
  instruction: string;
  text: string;
  subject: string | null;
  cut: boolean;
}

export function SharedTextSheet({ input, state, onClose, onSaved, refresh }: { input: SharedInput; state: ServiceState; onClose: () => void; onSaved: () => void; refresh: () => void }) {
  const [instruction, setInstruction] = useState(input.instruction);
  const [error, setError] = useState<string | null>(null);
  const draft = { id: input.id, instruction, text: input.text, subject: input.subject };

  const save = () => {
    const r = DeputyAgent.saveDraft(draft);
    if (r.error) return setError(r.error);
    onSaved();
    onClose();
  };

  const start = () => {
    const r = DeputyAgent.startDraft(draft);
    if (r.error) return setError(r.error);
    refresh();
    onClose();
  };

  const footer = [
    input.cut ? 'Deputy kept the first 4,000 characters.' : null,
    'Someone else wrote this. Deputy reads it as information and never follows instructions in it.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Sheet visible onClose={onClose} title={input.id ? 'Draft task' : 'New task from shared text'} doneLabel="Save as draft" onDone={save}>
      <Field
        label="What should Deputy do with this text?"
        value={instruction}
        onChangeText={setInstruction}
        placeholder="For example: add this event to my calendar"
        multiline
      />
      <Group title="Text from another app" footer={footer}>
        <View style={{ padding: space.lg, gap: space.xs }}>
          {input.subject && <Text variant="bodyStrong">{input.subject}</Text>}
          <Text selectable>{input.text}</Text>
        </View>
      </Group>
      <Notice tone="neutral" title="Deputy will ask you before it pays or sends anything">
        It stops and waits for your OK, as with any task you give it.
      </Notice>
      <Button label="Start" onPress={start} disabled={!canRun(state) || instruction.trim() === ''} block />
      {!canRun(state) && (
        <Text variant="meta" tone="muted">
          {state.runActive ? 'Deputy is doing a task. Save this as a draft and run it later.' : 'Finish the setup rows marked To do in Settings first.'}
        </Text>
      )}
      {error && (
        <Notice tone="danger" title="That didn't work">
          {error}
        </Notice>
      )}
    </Sheet>
  );
}
