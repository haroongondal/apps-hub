import React, { useCallback, useEffect, useState } from 'react';
import { Button, Field, Group, Notice, Row, Text } from '@apps-hub/ui';
import InflowCore, { addCapturedListener, type GmailStatus } from 'inflow-core';
import { cleanAppPassword, gmailFormError, syncLabel } from './gmail.ts';
import { LOAD_ERROR, SAVE_ERROR } from './messages.ts';

const HELP =
  'Inflow reads emails only from the senders below. It needs an app password: turn on 2-Step Verification in your Google account, open myaccount.google.com/apppasswords, make one for Inflow and paste it here.';
const FOOTER = "The password stays in Inflow's encrypted history on this phone. Inflow connects only to Gmail.";

export function GmailSettings() {
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [address, setAddress] = useState('');
  // The password lives only in this form; it is cleared once the sign-in is accepted and never read back.
  const [password, setPassword] = useState('');
  const [sender, setSender] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      setGmail(InflowCore.gmailStatus());
    } catch {
      setError(LOAD_ERROR);
    }
  }, []);
  useEffect(() => {
    load();
    const sub = addCapturedListener(load);
    return () => sub.remove();
  }, [load]);

  const change = (apply: () => void) => {
    try {
      apply();
      setError(null);
    } catch {
      setError(SAVE_ERROR);
    }
    load();
  };

  const check = () => {
    setBusy('sync');
    setError(null);
    InflowCore.syncGmail()
      .catch(() => setError(SAVE_ERROR))
      .finally(() => {
        setBusy(null);
        load();
      });
  };

  const connect = () => {
    const problem = gmailFormError(address, password);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy('connect');
    setError(null);
    InflowCore.connectGmail(address.trim(), cleanAppPassword(password))
      .then((r) => {
        if (!r.ok) setError(r.message ?? SAVE_ERROR);
        else {
          setPassword('');
          setAddress('');
        }
        return r.ok;
      })
      .catch(() => {
        setError(SAVE_ERROR);
        return false;
      })
      .then((ok) => {
        setBusy(null);
        load();
        if (ok) check();   // the first sync; a refused password or no network then shows in the status
      });
  };

  const addSender = () => {
    if (sender.trim() === '') return;
    change(() => InflowCore.addGmailSender(sender));
    setSender('');
  };

  const connected = gmail?.address != null;
  const shownError = error ?? (connected ? gmail.error : null);

  return (
    <>
      <Group title="Gmail">
        {connected ? <Row title={gmail.address} subtitle={syncLabel(gmail.lastSyncAt, Date.now())} /> : <Row title={<Text tone="muted">Not connected</Text>} />}
      </Group>
      {shownError !== null && <Notice tone="danger">{shownError}</Notice>}
      {connected ? (
        <>
          <Button label="Check now" variant="secondary" busy={busy === 'sync'} onPress={check} block />
          <Button label="Disconnect" variant="danger" onPress={() => change(() => InflowCore.disconnectGmail())} block />
        </>
      ) : (
        <>
          <Field
            label="Gmail address"
            value={address}
            onChangeText={setAddress}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
          <Field
            label="App password"
            hint={HELP}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            returnKeyType="done"
            onSubmitEditing={connect}
          />
          <Button label="Connect" busy={busy === 'connect'} onPress={connect} block />
        </>
      )}
      <Group title="Download emails from">
        {(gmail?.senders ?? []).length === 0 ? (
          <Row title={<Text tone="muted">No senders yet</Text>} />
        ) : (
          (gmail?.senders ?? []).map((s) => (
            <Row key={s} title={s} trailing={<Button label="Remove" variant="ghost" size="sm" onPress={() => change(() => InflowCore.removeGmailSender(s))} />} />
          ))
        )}
      </Group>
      <Field
        label="Add a sender"
        hint="An email address or a name, as it appears in the From line."
        value={sender}
        onChangeText={setSender}
        onSubmitEditing={addSender}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
      />
      <Notice>{FOOTER}</Notice>
    </>
  );
}
