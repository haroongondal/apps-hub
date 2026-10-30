import React, { useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import Vault from 'strongroom-vault';
import { isLocked, messageOf, whileDeriving } from './call.ts';
import { validateMasterPassword } from './forms.ts';
import { BackButton, NewPasswordFields, RecoveryKeyCard, SecretField } from './parts.tsx';

interface Flow {
  onBack: () => void;
  onDone: (notice: string) => void;
  onLocked: () => void;
}

interface AskProps {
  title: string;
  intro: string;
  action: string;
  wrong: string;
  run: (password: string) => Promise<boolean>;
  onSuccess?: () => void;
  onBack: () => void;
  onLocked: () => void;
}

function AskPassword({ title, intro, action, wrong, run, onSuccess, onBack, onLocked }: AskProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await run(password)) return onSuccess?.();
      setError(wrong);
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setError(messageOf(e));
    }
    setBusy(false);
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title={title} subtitle={intro} />
      <SecretField label="Master password" value={password} onChangeText={setPassword} onSubmitEditing={submit} error={error} />
      <Button label={action} onPress={submit} busy={busy} disabled={password === ''} block />
    </Screen>
  );
}

export function FingerprintScreen({ onBack, onDone, onLocked }: Flow) {
  return (
    <AskPassword
      onBack={onBack}
      onLocked={onLocked}
      title="Turn on fingerprint"
      intro="Enter your master password to turn on fingerprint unlock. Then touch the sensor when Android asks."
      action="Turn on"
      wrong="That password is wrong, or the fingerprint prompt was cancelled. Try again."
      run={(pw) => whileDeriving(() => Vault.setBiometric(true, pw))}
      onSuccess={() => onDone('Fingerprint is on.')}
    />
  );
}

// The old key stops working the moment the new one exists, so the key stays up until the owner taps the button: App ignores Back here.
export function NewRecoveryKeyScreen({ shown, onKey, onBack, onDone, onLocked }: Flow & { shown: string | null; onKey: (key: string) => void }) {
  if (shown !== null) {
    return (
      <Screen scroll>
        <Header title="Your new recovery key" subtitle="The old key no longer works." />
        <RecoveryKeyCard value={shown} />
        <Notice tone="warn">Write it down or print it, and keep it somewhere safe. Anyone with this key can open your vault.</Notice>
        <Button label="I've saved it" onPress={() => onDone('New recovery key saved.')} block />
      </Screen>
    );
  }
  return (
    <AskPassword
      onBack={onBack}
      onLocked={onLocked}
      title="New recovery key"
      intro="Enter your master password. The old recovery key stops working as soon as you get the new one."
      action="Create new key"
      wrong="That password is wrong. Try again."
      run={async (pw) => {
        const key = await whileDeriving(() => Vault.newRecoveryKey(pw));
        if (key === null) return false;
        onKey(key);
        return true;
      }}
    />
  );
}

export function ChangePasswordScreen({ onBack, onDone, onLocked }: Flow) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wrongCurrent, setWrongCurrent] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setWrongCurrent(null);
    setFault(null);
    const problem = validateMasterPassword(password, confirm);
    setRule(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (await whileDeriving(() => Vault.changePassword(current, password))) return onDone('Master password changed.');
      setWrongCurrent('That password is wrong. Try again.');
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setFault(messageOf(e));
    }
    setBusy(false);
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Change master password" subtitle="Your vault stays as it is. Only the password that opens it changes." />
      <SecretField label="Current master password" value={current} onChangeText={setCurrent} error={wrongCurrent} />
      <NewPasswordFields label="New master password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={rule} />
      {fault && <Notice tone="danger">{fault}</Notice>}
      <Button label="Change password" onPress={change} busy={busy} disabled={current === ''} block />
    </Screen>
  );
}
