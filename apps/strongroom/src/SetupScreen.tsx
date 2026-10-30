import React, { useState } from 'react';
import { Button, Group, Header, Notice, Row, Screen } from '@apps-hub/ui';
import Vault, { type Status } from 'strongroom-vault';
import { messageOf, whileDeriving } from './call.ts';
import { pickGroupIndex, recoveryGroupMatches, validateMasterPassword } from './forms.ts';
import { ImportScreen } from './ImportScreen.tsx';
import { NewPasswordFields, RecoveryKeyCard, SecretField } from './parts.tsx';

type Step = 'password' | 'key' | 'verify' | 'fingerprint' | 'autofill' | 'chrome' | 'import' | 'importing';

const CHROME_STEPS = ['Open Chrome, then Settings.', 'Tap Autofill services.', 'Choose Autofill using another service.'];

// The vault is created at "verify" (it needs the recovery key), so the later steps run on an unlocked vault.
export function SetupScreen({ status, onFinished }: { status: Status; onFinished: () => void }) {
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [key, setKey] = useState('');
  const [group, setGroup] = useState(0);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (next: Step) => {
    setError(null);
    setFault(null);
    setStep(next);
  };

  const choosePassword = () => {
    const problem = validateMasterPassword(password, confirm);
    if (problem) return setError(problem);
    try {
      setKey(Vault.generateRecoveryKey());
    } catch (e) {
      return setFault(messageOf(e));
    }
    setGroup(pickGroupIndex(Math.random));
    go('key');
  };

  const forgetPassword = () => {
    setPassword('');
    setConfirm('');
  };

  const skipFingerprint = () => {
    forgetPassword();
    go('autofill');
  };

  const openAutofillSettings = () => {
    try {
      Vault.openAutofillSettings();
    } catch (e) {
      setFault(messageOf(e));
    }
  };

  const verify = async () => {
    if (!recoveryGroupMatches(key, group, typed)) return setError(`That isn't group ${group + 1}. Check the key you wrote down and try again.`);
    setBusy(true);
    try {
      await whileDeriving(() => Vault.setUp(password, key));
      setKey('');
      setTyped('');
      setConfirm('');
      go('fingerprint');
    } catch (e) {
      setFault(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOnFingerprint = async () => {
    setBusy(true);
    try {
      if (await whileDeriving(() => Vault.setBiometric(true, password))) {
        forgetPassword();
        go('autofill');
      } else {
        setFault("Fingerprint wasn't turned on. Try again, or skip it and turn it on later in Settings.");
      }
    } catch (e) {
      setFault(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'importing') return <ImportScreen onBack={() => go('import')} onDone={onFinished} onLocked={onFinished} />;

  return (
    <Screen scroll>
      {step === 'password' && (
        <>
          <Header title="Create your master password" subtitle="It opens your vault. If you forget it, only your recovery key can." />
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={error} />
          {fault && <Notice tone="danger">{fault}</Notice>}
          <Button label="Continue" onPress={choosePassword} block />
        </>
      )}
      {step === 'key' && (
        <>
          <Header title="Your recovery key" subtitle="If you ever forget your master password, this key is the only way back in." />
          <RecoveryKeyCard value={key} />
          <Notice tone="warn">Write it down or print it, and keep it somewhere safe. Anyone with this key can open your vault.</Notice>
          <Button label="I've saved it" onPress={() => go('verify')} block />
        </>
      )}
      {step === 'verify' && (
        <>
          <Header title="Check your recovery key" subtitle={`Type group ${group + 1} of the key you wrote down. Each group is four characters.`} />
          <SecretField label={`Group ${group + 1}`} value={typed} onChangeText={setTyped} error={error} mono />
          {fault && <Notice tone="danger">{fault}</Notice>}
          <Button label="Create my vault" onPress={verify} busy={busy} block />
          <Button label="Show the key again" variant="ghost" onPress={() => go('key')} disabled={busy} />
        </>
      )}
      {step === 'fingerprint' && (
        <>
          <Header title="Unlock with your fingerprint" subtitle="You type the master password after a restart, or if the fingerprint fails." />
          {fault && <Notice tone="danger">{fault}</Notice>}
          <Button label="Turn on fingerprint" onPress={turnOnFingerprint} busy={busy} block />
          <Button label="Skip for now" variant="ghost" onPress={() => skipFingerprint()} disabled={busy} />
        </>
      )}
      {step === 'autofill' && (
        <>
          <Header title="Fill passwords in other apps" subtitle="Strongroom fills logins through Android's autofill service. Choose Strongroom on the next screen." />
          {status.autofillSelected && <Notice tone="ok">Strongroom is your autofill service.</Notice>}
          {fault && <Notice tone="danger">{fault}</Notice>}
          {status.autofillSelected ? (
            <Button label="Continue" onPress={() => go('chrome')} block />
          ) : (
            <>
              <Button label="Open autofill settings" onPress={openAutofillSettings} block />
              <Button label="Skip for now" variant="ghost" onPress={() => go('chrome')} />
            </>
          )}
        </>
      )}
      {step === 'chrome' && (
        <>
          <Header title="Fill passwords in Chrome" subtitle="Chrome hands passwords to another app only when you allow it." />
          <Group footer="The wording can differ between Chrome versions. Firefox needs no setting.">
            {CHROME_STEPS.map((s, i) => (
              <Row key={s} title={`${i + 1}. ${s}`} />
            ))}
          </Group>
          <Button label="Continue" onPress={() => go('import')} block />
        </>
      )}
      {step === 'import' && (
        <>
          <Header title="Bring your passwords from Google" subtitle="This is a one-time move out of Google Password Manager. You can skip it and import later from Settings." />
          <Button label="Import from Google" onPress={() => go('importing')} block />
          <Button label="Finish setup" variant="ghost" onPress={onFinished} />
        </>
      )}
    </Screen>
  );
}
