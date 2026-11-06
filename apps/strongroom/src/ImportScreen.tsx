import React, { useState } from 'react';
import { Button, Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import Vault, { type ImportPreview } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { BackButton } from './parts.tsx';

const STEPS = ['In Google Password Manager, choose Settings, then Export passwords.', 'Pick the file it saved.'];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  onBack: () => void;
  onDone: () => void;
  onLocked: () => void;
}

export function ImportScreen({ onBack, onDone, onLocked }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => (isLocked(e) ? onLocked() : setError(messageOf(e)));

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await Vault.pickGoogleCsv();
      if (picked) setPreview(picked);
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };

  const commit = () => {
    try {
      setImported(Vault.commitImport());
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Screen scroll>
      <BackButton onPress={imported === null ? onBack : onDone} />
      <Header title="Import from Google" subtitle="A one-time move out of Google. Afterwards you delete the logins from Google yourself." />
      {imported === null && (
        <Group title="How">
          {STEPS.map((s, i) => (
            <Row key={s} title={`${i + 1}. ${s}`} />
          ))}
        </Group>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {imported === null && <Button label={preview ? 'Choose another file' : 'Choose file'} variant={preview ? 'secondary' : 'primary'} onPress={choose} busy={busy} block />}
      {preview && imported === null && (
        <>
          <Group title="In the file">
            <Row title={plural(preview.found, 'login found', 'logins found')} />
            <Row title={plural(preview.merged, 'duplicate merged', 'duplicates merged')} />
            {preview.flagged > 0 && (
              <Row
                title={plural(preview.flagged, 'login needs a look', 'logins need a look')}
                subtitle="They share a site and username with another login but have a different password, so both are kept."
              />
            )}
          </Group>
          <Button label={`Import ${plural(preview.found, 'login', 'logins')}`} onPress={commit} block />
        </>
      )}
      {imported !== null && (
        <>
          <Notice tone="ok">{`${plural(imported, 'login', 'logins')} imported.`}</Notice>
          <Notice tone="warn">
            Delete the exported file now. It isn't encrypted, so anyone who gets it can read every password in it.
          </Notice>
          <Button label="Done" onPress={onDone} block />
        </>
      )}
    </Screen>
  );
}
