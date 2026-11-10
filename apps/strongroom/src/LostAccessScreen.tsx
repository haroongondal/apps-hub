import React, { useEffect, useRef, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import Vault, { type LostAccessState } from 'strongroom-vault';
import { whileDeriving } from './call.ts';
import { validateMasterPassword } from './forms.ts';
import { BackButton, NewPasswordFields, SecretField } from './parts.tsx';
import { explainRecovery, lostAccessView } from './recovery-flow.ts';

const WRONG_CODE = "That code isn't right. Check the email we sent when you turned on email recovery, and try again.";
const SENT = 'We sent you an email. Open the link in it to start the 24-hour wait.';

// Runs with the vault locked: nothing here needs it, and the owner may be on a fresh phone with no account.
export function LostAccessScreen({ onBack, onUnlocked }: { onBack: () => void; onUnlocked: () => void }) {
  const [state, setState] = useState<LostAccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [rule, setRule] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  // One call at a time, so a double tap can't send two requests or open twice.
  const run = async (call: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (e) {
      if (mounted.current) setError(explainRecovery(e));
    }
    inFlight.current = false;
    if (mounted.current) setBusy(false);
  };

  // Only the newest answer counts, so a slow older check can't overwrite a newer one.
  const check = async () => {
    const mine = ++latest.current;
    const next = await Vault.lostAccessCheck();
    if (mounted.current && mine === latest.current) setState(next);
  };

  useEffect(() => {
    mounted.current = true;
    void run(check);
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = () =>
    run(async () => {
      setInfo(null);
      await Vault.lostAccessRequest();
      setInfo(SENT);
      await check();
    });

  const open = () =>
    run(async () => {
      const problem = validateMasterPassword(password, confirm);
      setRule(problem);
      setCodeError(null);
      if (problem) return;
      if (await whileDeriving(() => Vault.lostAccessOpen(code, password))) return onUnlocked();
      setCodeError(WRONG_CODE);
    });

  const view = state && lostAccessView(state, Date.now());
  const waiting = state?.state === 'waiting';
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="I also lost my recovery key" />
      {info && <Notice tone="ok">{info}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {view && <Notice title={view.title}>{view.body}</Notice>}
      {view?.actions.includes('request') && <Button label={waiting ? 'Send the email again' : 'Email me the link'} onPress={request} busy={busy} block />}
      {view?.actions.includes('enterCode') && (
        <>
          <SecretField label="Code from the email" value={code} onChangeText={setCode} error={codeError} mono />
          <NewPasswordFields label="New master password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={rule} onSubmit={open} />
          <Button label="Reset and unlock" onPress={open} busy={busy} disabled={code.trim() === ''} block />
        </>
      )}
      {state?.state !== 'ready' && <Button label="Check again" variant={state === null ? 'primary' : 'ghost'} onPress={() => run(check)} disabled={busy} />}
    </Screen>
  );
}
