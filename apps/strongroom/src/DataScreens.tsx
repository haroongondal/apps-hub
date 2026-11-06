import React, { useEffect, useRef, useState } from 'react';
import { Button, Group, Header, Notice, Row, Screen, Sheet, Text } from '@apps-hub/ui';
import Vault, { type ExportCounts, type ImportBatch } from 'strongroom-vault';
import { isLocked, messageOf, whileDeriving } from './call.ts';
import { entries, exportedNotice, importConfirm, importRow } from './forms.ts';
import { BackButton } from './parts.tsx';
import { AskPassword } from './SettingsFlows.tsx';

interface Flow {
  onBack: () => void;
  onDone: (notice: string) => void;
  onLocked: () => void;
}

const WRONG = 'That password is wrong. Try again.';

export function ExportScreen({ onBack, onDone, onLocked }: Flow) {
  const counts = useRef<ExportCounts | null>(null);
  return (
    <AskPassword
      onBack={onBack}
      onLocked={onLocked}
      title="Export all"
      intro="Saves every login, card and note to a CSV file you choose. The file isn't encrypted: anyone who gets it can read every password in it."
      action="Export"
      wrong={WRONG}
      run={async (pw) => (counts.current = await whileDeriving(() => Vault.exportAll(pw))) !== null}
      onSuccess={() => onDone(exportedNotice(counts.current!))}
    />
  );
}

export function DeleteAllScreen({ onBack, onDone, onLocked }: Flow) {
  const deleted = useRef(0);
  return (
    <AskPassword
      onBack={onBack}
      onLocked={onLocked}
      title="Delete all passwords"
      intro="Deletes every login, card and note in Strongroom. With sync on, they go from your other devices too. This can't be undone, so export first if you want a copy."
      action="Delete everything"
      wrong={WRONG}
      run={async (pw) => {
        const n = await whileDeriving(() => Vault.deleteAll(pw));
        deleted.current = n ?? 0;
        return n !== null;
      }}
      onSuccess={() => onDone(`Deleted ${entries(deleted.current)}.`)}
    />
  );
}

export function ImportsScreen({ onBack, onLocked }: Omit<Flow, 'onDone'>) {
  const [list, setList] = useState<ImportBatch[] | null>(null);
  const [picked, setPicked] = useState<ImportBatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setError(messageOf(e)));

  const load = () => {
    try {
      setList(Vault.imports());
    } catch (e) {
      fail(e);
    }
  };
  useEffect(load, []);

  const remove = () => {
    const batch = picked;
    setPicked(null);
    if (!batch) return;
    try {
      setNotice(`Deleted ${entries(Vault.deleteImport(batch.at))} from ${importRow(batch).title}.`);
      setError(null);
    } catch (e) {
      fail(e);
    }
    load();
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Imported files" subtitle="Delete what one file brought in. Entries you've edited since stay." />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {list?.length === 0 && <Text>Nothing imported is left in your vault.</Text>}
      {list && list.length > 0 && (
        <Group>
          {list.map((b) => (
            <Row key={b.at} {...importRow(b)} onPress={() => setPicked(b)} />
          ))}
        </Group>
      )}
      <Sheet visible={picked !== null} onClose={() => setPicked(null)} title="Delete this import?" doneLabel="Cancel">
        <Text>{picked ? importConfirm(picked) : ''}</Text>
        <Button label="Delete" variant="danger" onPress={remove} block />
      </Sheet>
    </Screen>
  );
}
