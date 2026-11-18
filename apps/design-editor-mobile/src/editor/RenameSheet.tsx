import { Field, Sheet } from '@apps-hub/ui';
import { useState } from 'react';

import { cleanDesignName, MAX_NAME } from './saved-list';

export function RenameSheet({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit: (name: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!cleanDesignName(value)) return setError('Type a name.');
    setBusy(true);
    try {
      await onSubmit(value);
      onClose();
    } catch {
      setError('That didn\u2019t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet visible title={title} doneLabel="Save" onClose={onClose} onDone={submit}>
      <Field label="Name" value={value} onChangeText={setValue} error={error} maxLength={MAX_NAME} autoFocus returnKeyType="done" onSubmitEditing={submit} />
    </Sheet>
  );
}
