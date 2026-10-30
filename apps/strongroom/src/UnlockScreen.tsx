import React, { useEffect, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import Vault, { type Status } from 'strongroom-vault';
import { messageOf, whileDeriving } from './call.ts';
import { validateMasterPassword } from './forms.ts';
import { BackButton, NewPasswordFields, SecretField } from './parts.tsx';

export function UnlockScreen({ status, notice, onUnlocked }: { status: Status; notice: string | null; onUnlocked: () => void }) {
  const [recovering, setRecovering] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (call: () => Promise<boolean>, wrong: string) => {
    setBusy(true);
    setError(null);
    try {
      if (await whileDeriving(call)) return onUnlocked();
      setError(wrong);
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  };

  const withPassword = () => password !== '' && attempt(() => Vault.unlock(password), 'That password is wrong. Try again.');
  const withFingerprint = (quiet: boolean) => attempt(() => Vault.unlockWithBiometric(), quiet ? '' : "The fingerprint wasn't accepted. Try again, or type your master password.");

  // Offered once on opening; a cancel, or a restart that requires the password, leaves the password field without an error.
  useEffect(() => {
    if (status.biometricEnabled) void withFingerprint(true);
  }, []);

  if (recovering) return <Recover onBack={() => setRecovering(false)} onUnlocked={onUnlocked} />;

  return (
    <Screen scroll>
      <Header title="Strongroom" subtitle="Enter your master password to open your vault." />
      {notice && <Notice tone="warn">{notice}</Notice>}
      <SecretField label="Master password" value={password} onChangeText={setPassword} onSubmitEditing={withPassword} error={error} />
      <Button label="Unlock" onPress={withPassword} busy={busy} disabled={password === ''} block />
      {status.biometricEnabled && <Button label="Use fingerprint" variant="secondary" onPress={() => withFingerprint(false)} disabled={busy} block />}
      <Button label="Forgot master password" variant="ghost" onPress={() => setRecovering(true)} disabled={busy} />
    </Screen>
  );
}

function Recover({ onBack, onUnlocked }: { onBack: () => void; onUnlocked: () => void }) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setKeyError(null);
    setFault(null);
    const problem = validateMasterPassword(password, confirm);
    setRule(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (await whileDeriving(() => Vault.recover(recoveryKey, password))) return onUnlocked();
      setKeyError("That recovery key doesn't open this vault. Check each group and try again.");
    } catch (e) {
      setFault(messageOf(e));
    }
    setBusy(false);
  };

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Reset your master password" subtitle="Enter the recovery key you wrote down, then choose a new master password." />
      <SecretField label="Recovery key" value={recoveryKey} onChangeText={setRecoveryKey} error={keyError} mono />
      <NewPasswordFields label="New master password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={rule} />
      <Notice tone="neutral">Your logins, cards and notes stay as they are. Only the master password changes.</Notice>
      {fault && <Notice tone="danger">{fault}</Notice>}
      <Button label="Reset and unlock" onPress={reset} busy={busy} block />
    </Screen>
  );
}
