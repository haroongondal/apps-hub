import React, { useEffect, useState } from 'react';
import { Button, Field, Group, Notice, Row, Sheet, confirmAction } from '@apps-hub/ui';
import InflowCore from 'inflow-core';
import { SAVE_ERROR } from './messages.ts';
import { removeNameConfirm } from './records.ts';

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
      setExisting([...new Set(InflowCore.listSenderNames().map((n) => n.name))]);
    } catch {
      setExisting([]);
      setError(SAVE_ERROR);
    }
  }, [target?.senderKey]);

  const apply = (value: string | null) => {
    if (!target) return;
    try {
      InflowCore.renameSender(target.senderKey, value);
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };
  const save = () => {
    const trimmed = name.trim();
    if (trimmed !== '') return apply(trimmed);
    // An empty name removes the saved one, so it asks first; with no saved name there is nothing to remove.
    if (target?.name != null) remove();
    else apply(null);
  };

  const remove = () => {
    if (!target || target.name === null) return;
    const c = removeNameConfirm(target.name, target.sender);
    confirmAction({ title: c.title, message: c.message, confirmLabel: c.confirmLabel, onConfirm: () => apply(null) });
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
      {target?.name != null && <Button label="Remove name" variant="danger" onPress={remove} block />}
    </Sheet>
  );
}
