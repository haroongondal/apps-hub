import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, Row, Screen, Segmented, space, useTheme } from '@apps-hub/ui';
import Vault, { type Diagnostics, type Status } from 'strongroom-vault';
import { isLocked, messageOf, whileDeriving } from './call.ts';
import { validateMasterPassword } from './forms.ts';
import { BackButton, NewPasswordFields, RecoveryKeyCard, SecretField } from './parts.tsx';

const MINUTES = [
  { key: '1', label: '1 minute' },
  { key: '5', label: '5 minutes' },
  { key: '15', label: '15 minutes' },
] as const;

const BROWSERS: Record<string, string> = { 'com.android.chrome': 'Chrome', 'org.mozilla.firefox': 'Firefox' };

type Mode = 'main' | 'fingerprint' | 'password' | 'recoveryAsk' | 'recoveryShow';

interface Props {
  status: Status;
  refresh: () => void;
  onImport: () => void;
}

export function SettingsScreen({ status, refresh, onImport }: Props) {
  const { c } = useTheme();
  const [mode, setMode] = useState<Mode>('main');
  const [newKey, setNewKey] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Diagnostics | null>(null);

  const fail = (e: unknown) => (isLocked(e) ? refresh() : setError(messageOf(e)));

  useEffect(() => {
    try {
      setChecks(Vault.diagnostics());
    } catch (e) {
      fail(e);
    }
  }, []);

  const back = (done?: string) => {
    setNotice(done ?? null);
    setNewKey('');
    setMode('main');
    refresh();
  };

  if (mode === 'fingerprint') {
    return (
      <AskPassword
        title="Turn on fingerprint"
        intro="Enter your master password to turn on fingerprint unlock. Then touch the sensor when Android asks."
        action="Turn on"
        wrong="That password is wrong, or the fingerprint prompt was cancelled. Try again."
        run={(pw) => whileDeriving(() => Vault.setBiometric(true, pw))}
        onSuccess={() => back('Fingerprint is on.')}
        onBack={() => back()}
        onLocked={refresh}
      />
    );
  }
  if (mode === 'recoveryAsk') {
    return (
      <AskPassword
        title="New recovery key"
        intro="Enter your master password. The old recovery key stops working as soon as you get the new one."
        action="Create new key"
        wrong="That password is wrong. Try again."
        run={async (pw) => {
          const key = await whileDeriving(() => Vault.newRecoveryKey(pw));
          if (key === null) return false;
          setNewKey(key);
          return true;
        }}
        onSuccess={() => setMode('recoveryShow')}
        onBack={() => back()}
        onLocked={refresh}
      />
    );
  }
  if (mode === 'recoveryShow') {
    return (
      <Screen scroll>
        <Header title="Your new recovery key" subtitle="The old key no longer works." />
        <RecoveryKeyCard value={newKey} />
        <Notice tone="warn">Write it down or print it, and keep it somewhere safe. Anyone with this key can open your vault.</Notice>
        <Button label="I've saved it" onPress={() => back('New recovery key saved.')} block />
      </Screen>
    );
  }
  if (mode === 'password') return <ChangePassword onBack={back} onLocked={refresh} />;

  const setMinutes = (key: (typeof MINUTES)[number]['key']) => {
    try {
      Vault.setAutoLockMinutes(Number(key) as 1 | 5 | 15);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const open = (next: Mode) => {
    setNotice(null);
    setMode(next);
  };

  const lockNow = () => {
    Vault.lock();
    refresh();
  };

  const toggleFingerprint = async (on: boolean) => {
    if (on) return open('fingerprint');
    try {
      await Vault.setBiometric(false);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Screen scroll>
      <Header title="Settings" />
      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <Group title="Auto-lock after" footer="Strongroom also locks when the phone restarts.">
        <View style={{ padding: space.md }}>
          <Segmented options={MINUTES} value={String(status.autoLockMinutes) as (typeof MINUTES)[number]['key']} onChange={setMinutes} accessibilityLabel="Auto-lock time" />
        </View>
      </Group>
      <Group>
        <Row
          title="Unlock with fingerprint"
          trailing={
            <Switch
              value={status.biometricEnabled}
              onValueChange={toggleFingerprint}
              accessibilityLabel="Unlock with fingerprint"
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor={c.surface}
            />
          }
        />
      </Group>
      <Group title="Master password and recovery key">
        <Row title="Change master password" onPress={() => open('password')} />
        <Row title="New recovery key" subtitle="Replaces the key you wrote down." onPress={() => open('recoveryAsk')} />
      </Group>
      <Group title="Your passwords">
        <Row title="Import from Google" subtitle="Move your saved passwords out of Google Password Manager." onPress={onImport} />
      </Group>
      <Button label="Lock now" variant="secondary" onPress={lockNow} block />
      <Group title="Checks" footer="Autofill fills a browser only when Strongroom recognises it.">
        <Row
          title="Last unlock"
          subtitle={checks ? (checks.lastUnlockMs === null ? 'Not timed yet' : `Took ${(checks.lastUnlockMs / 1000).toFixed(1)} seconds`) : undefined}
        />
        {checks?.browsers
          .filter((b) => b.installed)
          .map((b) => {
            const name = BROWSERS[b.pkg] ?? b.pkg;
            return (
              <Row
                key={b.pkg}
                title={name}
                subtitle={b.trusted ? undefined : `Not recognised: autofill won't work in ${name}`}
                trailing={b.trusted ? <Pill label="Recognised" tone="ok" /> : <Pill label="Not recognised" tone="warn" />}
              />
            );
          })}
      </Group>
    </Screen>
  );
}

interface AskProps {
  title: string;
  intro: string;
  action: string;
  wrong: string;
  run: (password: string) => Promise<boolean>;
  onSuccess: () => void;
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
      if (await run(password)) return onSuccess();
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

function ChangePassword({ onBack, onLocked }: { onBack: (done?: string) => void; onLocked: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wrongCurrent, setWrongCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setWrongCurrent(null);
    const problem = validateMasterPassword(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      if (await whileDeriving(() => Vault.changePassword(current, password))) return onBack('Master password changed.');
      setWrongCurrent('That password is wrong. Try again.');
    } catch (e) {
      if (isLocked(e)) return onLocked();
      setError(messageOf(e));
    }
    setBusy(false);
  };

  return (
    <Screen scroll>
      <BackButton onPress={() => onBack()} />
      <Header title="Change master password" subtitle="Your vault stays as it is. Only the password that opens it changes." />
      <SecretField label="Current master password" value={current} onChangeText={setCurrent} error={wrongCurrent} />
      <NewPasswordFields label="New master password" password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={error} />
      <Button label="Change password" onPress={change} busy={busy} disabled={current === ''} block />
    </Screen>
  );
}
