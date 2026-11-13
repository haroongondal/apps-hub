import React, { useEffect, useState } from 'react';
import { Button, Field, Group, Notice, Row, Sheet } from '@apps-hub/ui';
import NoteboxCore from 'notebox-core';
import { SAVE_ERROR } from './messages.ts';

export interface RenameTarget {
  senderKey: string;
  sender: string;
  name: string | null;
}

export function RenameSheet({ target, onClose, onSaved }: { target: RenameTarget | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [existing, setExisting] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setName(target.name ?? '');
    setError(null);
    try {
      setExisting([...new Set(NoteboxCore.listSenderNames().map((n) => n.name))]);
    } catch {
      setExisting([]);
      setError(SAVE_ERROR);
    }
  }, [target?.senderKey]);

  const apply = (value: string | null) => {
    if (!target) return;
    try {
      NoteboxCore.renameSender(target.senderKey, value);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };
  const save = () => {
    const trimmed = name.trim();
    apply(trimmed === '' ? null : trimmed);
  };

  return (
    <Sheet visible={target !== null} onClose={onClose} title="Rename sender" doneLabel="Save" onDone={save}>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Field
        label="Name"
        hint={target ? `Shown instead of ${target.sender}. Use the same name for several numbers to group them.` : undefined}
        value={name}
        onChangeText={setName}
        onSubmitEditing={save}
        returnKeyType="done"
        autoCapitalize="words"
      />
      {existing.length > 0 && (
        <Group title="Names you already use">
          {existing.map((n) => (
            <Row key={n} title={n} onPress={() => setName(n)} accessibilityHint="Uses this name" />
          ))}
        </Group>
      )}
      {target?.name != null && <Button label="Remove name" variant="danger" onPress={() => apply(null)} block />}
    </Sheet>
  );
}
