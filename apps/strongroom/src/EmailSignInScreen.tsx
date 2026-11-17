import React, { useEffect, useRef, useState } from 'react';
import { Button, Header, Notice, Screen } from '@apps-hub/ui';
import Vault, { type LostAccessState } from 'strongroom-vault';
import { isLocked, whileDeriving } from './call.ts';
import { BackButton, SecretField } from './parts.tsx';
import { EMAIL_SIGN_IN_WRONG_CODE, emailSignInView, explainEmailSignIn } from './recovery-flow.ts';

const SENT = 'If this account has email recovery on, an email with an approval link is on its way. You can ask again an hour after the first request.';

// A new phone with no account key: the emailed approval, then the code from the email recovery email and the master password.
export function EmailSignInScreen({ onBack, onDone, onLocked }: { onBack: () => void; onDone: () => void; onLocked: () => void }) {
  const [state, setState] = useState<LostAccessState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  // One call at a time, so a double tap can't send two requests or sign in twice.
  const run = async (call: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (e) {
      if (isLocked(e)) {
        inFlight.current = false;
        return onLocked();
      }
      if (mounted.current) setError(explainEmailSignIn(e));
    }
    inFlight.current = false;
    if (mounted.current) setBusy(false);
  };

  // Only the newest answer counts, so a slow older check can't overwrite a newer one.
  const check = async () => {
    const mine = ++latest.current;
    const next = await Vault.emailSignInCheck();
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
      await Vault.emailSignInRequest();
      setInfo(SENT);
      await check();
    });

  const open = () =>
    run(async () => {
      setCodeError(null);
      if (await whileDeriving(() => Vault.emailSignInOpen(code, password))) return onDone();
      setCodeError(EMAIL_SIGN_IN_WRONG_CODE);
    });

  const view = state && emailSignInView(state);
  const waiting = state?.state === 'waiting';
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Sign in with your email code" />
      {info && <Notice tone="ok">{info}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {view && <Notice>{view.body}</Notice>}
      {view?.actions.includes('request') && <Button label={waiting ? 'Ask again' : 'Email me an approval link'} onPress={request} busy={busy} block />}
      {view?.actions.includes('enterCode') && (
        <>
          <SecretField label="Code from the email" value={code} onChangeText={setCode} error={codeError} mono />
          <SecretField label="Master password" value={password} onChangeText={setPassword} onSubmitEditing={open} />
          <Button label="Sign in" onPress={open} busy={busy} disabled={code.trim() === '' || password === ''} block />
        </>
      )}
      {state?.state !== 'ready' && <Button label="Check again" variant={state === null || waiting ? 'primary' : 'ghost'} onPress={() => run(check)} disabled={busy} />}
    </Screen>
  );
}
