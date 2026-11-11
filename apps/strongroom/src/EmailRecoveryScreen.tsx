import React, { useEffect, useRef, useState } from 'react';
import { Button, Field, Header, Notice, Screen, Text } from '@apps-hub/ui';
import Vault, { type EmailRecoveryStatus } from 'strongroom-vault';
import { isLocked, whileDeriving } from './call.ts';
import { BackButton, RecoveryKeyCard, SecretField } from './parts.tsx';
import { EMAIL_DISCLOSURE, emailProblem, emailRecoveryView, emailSyncGate, explainRecovery, type EmailRecoveryAction } from './recovery-flow.ts';
import { useSyncStatus } from './SyncScreen.tsx';
import { useEmailRecovery } from './useEmailRecovery.ts';

interface Props {
  onBack: () => void;
  onDone: (notice: string) => void;
  onLocked: () => void;
  // Opens the existing New recovery key flow, for a key that changed but was never saved.
  onNewKey: () => void;
  // True while the new recovery key is on screen and nothing else may take its place (App ignores the hardware Back).
  onHold: (holding: boolean) => void;
}

type Step = 'home' | 'disclosure' | 'form' | 'key' | 'code';

const LABEL: Record<EmailRecoveryAction, string> = {
  turnOn: 'Turn on email recovery',
  enterCode: 'Enter the code we emailed',
  turnOff: 'Turn off email recovery',
  cancel: 'Cancel the recovery request',
  newKey: 'Make a new recovery key',
};

const WRONG_PASSWORD = 'That password is wrong. Try again.';
const WRONG_CODE = "That code isn't right. Check the email we sent when you turned on email recovery, and try again.";
const ROTATES_KEY = "Turning this on makes a new recovery key, and the old one stops working. You'll see the new key next, so have something to write it on.";
// The phone saved the new key but the server never confirmed the request, so a code email may never come.
const NOT_CONFIRMED = "Your recovery key changed. We couldn't confirm email recovery. If no code email arrives, open Email recovery in Settings and turn it on again.";
// Used when the status call itself fails, so the screen shows the same "couldn't check" row instead of a blank.
const UNKNOWN: EmailRecoveryStatus = { available: true, checked: false, enrolled: false, waitingForCode: false, pendingRecovery: null, wasTurnedOff: false, keyUnseen: false };

export function EmailRecoveryScreen({ onBack, onDone, onLocked, onNewKey, onHold }: Props) {
  const { status, loaded, reload } = useEmailRecovery();
  const gate = emailSyncGate(useSyncStatus().status?.state);
  const [step, setStep] = useState<Step>('home');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [sent, setSent] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const holding = step === 'key';

  useEffect(() => {
    onHold(holding);
    return () => onHold(false);
  }, [holding]);

  const goHome = () => {
    setStep('home');
    setError(null);
    setCodeError(null);
    setCode('');
    setPassword('');
    setRecoveryKey(null);
    void reload();
  };

  // One call at a time, so a double tap can't send twice; a lock hands the screen back to App.
  const run = async (call: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await call();
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setError(explainRecovery(e));
    }
    inFlight.current = false;
    setBusy(false);
  };

  const enable = () =>
    run(async () => {
      const problem = emailProblem(email);
      setEmailError(problem);
      setPasswordError(null);
      if (problem) return;
      const made = await whileDeriving(() => Vault.enableEmailRecovery(email, password));
      if (made === null) return setPasswordError(WRONG_PASSWORD);
      setRecoveryKey(made.recoveryKey);
      setSent(made.sent);
      setStep('key');
    });

  const saved = () =>
    run(async () => {
      await Vault.markRecoveryKeyShown();
      if (sent) {
        setRecoveryKey(null);
        return setStep('code');
      }
      goHome();
      setInfo(NOT_CONFIRMED);
    });

  const confirm = () =>
    run(async () => {
      if (await Vault.confirmEmailRecovery(code)) return onDone('Email recovery is on.');
      setCodeError(WRONG_CODE);
    });

  const act = (action: EmailRecoveryAction) => {
    setInfo(null);
    setError(null);
    if (action === 'turnOn') return setStep('disclosure');
    if (action === 'enterCode') return setStep('code');
    if (action === 'newKey') return onNewKey();
    return run(async () => {
      if (action === 'turnOff') {
        await Vault.turnOffEmailRecovery();
        setInfo('Email recovery is off.');
      } else {
        await Vault.cancelLostRequest();
        setInfo('The recovery request is cancelled.');
      }
      void reload();
    });
  };

  if (step === 'key' && recoveryKey !== null) {
    return (
      <Screen scroll>
        <Header title="Your new recovery key" subtitle="The old key no longer works." />
        <RecoveryKeyCard value={recoveryKey} />
        <Notice tone="warn">Write it down or print it, and keep it somewhere safe. Anyone with this key can open your vault.</Notice>
        {!sent && <Notice tone="warn">{NOT_CONFIRMED}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button label="I've saved it" onPress={saved} busy={busy} block />
      </Screen>
    );
  }

  if (step === 'disclosure') {
    return (
      <Screen scroll>
        <BackButton onPress={goHome} />
        <Header title="Before you turn on email recovery" subtitle="Read these carefully. They decide who can reach your vault." />
        {EMAIL_DISCLOSURE.map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        <Button label="I understand, continue" onPress={() => setStep('form')} block />
      </Screen>
    );
  }

  if (step === 'form') {
    return (
      <Screen scroll>
        <BackButton onPress={goHome} />
        <Header title="Turn on email recovery" subtitle="Enter the address we should send the code to, and your master password." />
        <Notice tone="warn">{ROTATES_KEY}</Notice>
        <Field label="Email address" value={email} onChangeText={setEmail} error={emailError} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <SecretField label="Master password" value={password} onChangeText={setPassword} onSubmitEditing={enable} error={passwordError} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button label="Turn on" onPress={enable} busy={busy} disabled={email.trim() === '' || password === ''} block />
      </Screen>
    );
  }

  if (step === 'code') {
    return (
      <Screen scroll>
        <BackButton onPress={goHome} />
        <Header title="Enter the code we emailed" subtitle="Email recovery turns on once you type the code from your inbox. If it hasn't arrived, check your spam folder." />
        <SecretField label="Code" value={code} onChangeText={setCode} onSubmitEditing={confirm} error={codeError} mono />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button label="Confirm" onPress={confirm} busy={busy} disabled={code.trim() === ''} block />
      </Screen>
    );
  }

  const view = loaded ? emailRecoveryView(status ?? UNKNOWN) : null;
  // With sync off or signed out the answer is the sync notice, not "make sure this phone is online"; a key warning still shows.
  const syncBlocked = gate !== null && !status?.checked && !status?.keyUnseen;
  const actions = (view?.actions ?? []).filter((a) => !(gate !== null && a === 'turnOn'));
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Email recovery" subtitle="Get back into your vault by email if you lose both your master password and your recovery key." />
      {info && <Notice tone="ok">{info}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {!loaded && <Notice tone="neutral">Checking email recovery.</Notice>}
      {view && (
        <>
          {syncBlocked ? (
            <Notice tone="warn">{gate}</Notice>
          ) : (
            <Notice tone={view.tone} title={view.title}>
              {view.subtitle}
            </Notice>
          )}
          {actions.map((action, i) => (
            <Button key={action} label={LABEL[action]} variant={i === 0 ? 'primary' : 'secondary'} onPress={() => act(action)} disabled={busy} block />
          ))}
          {!(status?.checked ?? false) && !syncBlocked && <Button label="Check again" variant="ghost" onPress={() => void reload()} disabled={busy} />}
        </>
      )}
    </Screen>
  );
}
