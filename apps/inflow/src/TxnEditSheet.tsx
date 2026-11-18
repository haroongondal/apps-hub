import React, { useEffect, useState } from 'react';
import { Field, Notice, Sheet } from '@apps-hub/ui';
import InflowCore, { type Txn } from 'inflow-core';
import { SAVE_ERROR } from './messages.ts';

// Edit a transaction's clean name. The amount, account and time come from the bank message and are not editable; the category is picked on the transaction itself.
export function TxnEditSheet({ txn, onClose, onSaved }: { txn: Txn | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    setLabel(txn.label ?? '');
    setError(null);
  }, [txn?.id]);

  const save = () => {
    if (!txn) return;
    try {
      const problem = InflowCore.setTxnLabel(txn.id, label.trim() === '' ? null : label.trim());
      if (problem !== null) {
        setError(problem);
        return;
      }
    } catch {
      setError(SAVE_ERROR);
      return;
    }
    onSaved();
  };

  return (
    <Sheet visible={txn !== null} onClose={onClose} title="Edit name" doneLabel="Save" onDone={save}>
      {error !== null && <Notice tone="danger">{error}</Notice>}
      <Field
        label="Clean name"
        hint={txn?.counterparty != null ? `Shown instead of ${txn.counterparty}. Leave empty to show the name from the message.` : 'Shown in your list. Leave empty to use the name from the message.'}
        value={label}
        onChangeText={setLabel}
        onSubmitEditing={save}
        returnKeyType="done"
        autoCapitalize="words"
      />
    </Sheet>
  );
}
