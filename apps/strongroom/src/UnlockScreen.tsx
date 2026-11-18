import React, { useEffect, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import Vault, { type Status } from 'strongroom-vault';
import { messageOf, whileDeriving } from './call.ts';
import { validateMasterPassword } from './forms.ts';
import { LostAccessScreen } from './LostAccessScreen.tsx';
import { BackButton, NewPasswordFields, SecretField } from './parts.tsx';
import { SyncScreen, useSyncStatus } from './SyncScreen.tsx';
import { ACTION_LABEL, FIELD_LABEL, accountKeyProblems, explain, offerSignIn, type Problems } from './sync-flow.ts';

export function UnlockScreen({ status, notice, onUnlocked }: { status: Status; notice: string | null; onUnlocked: () => void }) {
  const [recovering, setRecovering] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const { status: sync } = useSyncStatus();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (call: () => Promise<boolean>, wrong: string) => {
    setBusy(true);
    setError(null);
    setFailure(null);
    try {
      if (await whileDeriving(call)) return onUnlocked();
      setError(wrong);
    } catch (e) {
      setFailure(e);
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

  if (recovering) {
    return (
      <Recover
        onBack={() => setRecovering(false)}
        onUnlocked={onUnlocked}
        onSignIn={() => {
          setRecovering(false);
          setSigningIn(true);
        }}
      />
    );
  }
  if (signingIn) return <SyncScreen start="signIn" onBack={() => setSigningIn(false)} onDone={() => onUnlocked()} onLocked={() => setSigningIn(false)} />;

  return (
    <Screen scroll>
      <Header title="Strongroom" subtitle="Enter your master password to open your vault." />
      {notice && <Notice tone="warn">{notice}</Notice>}
      <SecretField label="Master password" value={password} onChangeText={setPassword} onSubmitEditing={withPassword} error={error} />
      <Button label="Unlock" onPress={withPassword} busy={busy} disabled={password === ''} block />
      {status.biometricEnabled && <Button label="Use fingerprint" variant="secondary" onPress={() => withFingerprint(false)} disabled={busy} block />}
      <Button label="Forgot master password" variant="ghost" onPress={() => setRecovering(true)} disabled={busy} />
      {offerSignIn(sync, failure) && <Button label={ACTION_LABEL.signIn} variant="secondary" onPress={() => setSigningIn(true)} disabled={busy} block />}
    </Screen>
  );
}

function Recover({ onBack, onUnlocked, onSignIn }: { onBack: () => void; onUnlocked: () => void; onSignIn: () => void }) {
  const [lostKey, setLostKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [rule, setRule] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // A flagged vault whose account key this phone lost: the reset takes the written-down key instead.
  const [needKey, setNeedKey] = useState<string | null>(null);
  const [accountKey, setAccountKey] = useState('');
  const [accountKeyAgain, setAccountKeyAgain] = useState('');
  const [typedProblems, setTypedProblems] = useState<Problems>({});

  const reset = async () => {
    setKeyError(null);
    setFault(null);
    setFailure(null);
    const problem = validateMasterPassword(password, confirm);
    const typed = needKey ? accountKeyProblems({ accountKey, accountKeyAgain }) : {};
    setRule(problem);
    setTypedProblems(typed);
    if (problem || Object.keys(typed).length > 0) return;
    setBusy(true);
    try {
      if (await whileDeriving(() => Vault.recover(recoveryKey, password, needKey ? accountKey : undefined))) return onUnlocked();
      setKeyError("That recovery key doesn't open this vault. Check each group and try again.");
    } catch (e) {
      setFailure(e);
      const why = explain('recover', e);
      if (why.askAccountKey) setNeedKey(why.message);
      else setFault(messageOf(e));
    }
    setBusy(false);
  };

  if (lostKey) return <LostAccessScreen onBack={() => setLostKey(false)} onUnlocked={onUnlocked} />;

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Reset your master password" subtitle="Enter the recovery key you wrote down, then choose a new master password." />
      <SecretField label="Recovery key" value={recoveryKey} onChangeText={setRecoveryKey} error={keyError} mono />
      <NewPasswordFields label="New master password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={rule} />
      {needKey && (
        <>
          <Notice tone="warn">{needKey}</Notice>
          <SecretField label={FIELD_LABEL.accountKey} value={accountKey} onChangeText={setAccountKey} error={typedProblems.accountKey} mono />
          <SecretField label={FIELD_LABEL.accountKeyAgain} value={accountKeyAgain} onChangeText={setAccountKeyAgain} onSubmitEditing={reset} error={typedProblems.accountKeyAgain} mono />
        </>
      )}
      <Notice tone="neutral">Your logins, cards and notes stay as they are. Only the master password changes.</Notice>
      {fault && <Notice tone="danger">{fault}</Notice>}
      {offerSignIn(null, failure) && <Button label={ACTION_LABEL.signIn} variant="secondary" onPress={onSignIn} disabled={busy} block />}
      <Button label="Reset and unlock" onPress={reset} busy={busy} block />
      <Button label="I also lost my recovery key" variant="ghost" onPress={() => setLostKey(true)} disabled={busy} />
    </Screen>
  );
}
