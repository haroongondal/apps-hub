import React, { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, Row, Screen, Segmented, space, useTheme } from '@apps-hub/ui';
import Vault, { type Diagnostics, type Status } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';

const MINUTES = [
  { key: '1', label: '1 minute' },
  { key: '5', label: '5 minutes' },
  { key: '15', label: '15 minutes' },
] as const;

const BROWSERS: Record<string, string> = { 'com.android.chrome': 'Chrome', 'org.mozilla.firefox': 'Firefox' };

export type SettingsFlow = 'password' | 'fingerprint' | 'newKey' | 'import';

interface Props {
  status: Status;
  refresh: () => void;
  notice: string | null;
  onOpen: (flow: SettingsFlow) => void;
}

export function SettingsScreen({ status, refresh, notice, onOpen }: Props) {
  const { c } = useTheme();
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

  const setMinutes = (key: (typeof MINUTES)[number]['key']) => {
    try {
      Vault.setAutoLockMinutes(Number(key) as 1 | 5 | 15);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const lockNow = () => {
    try {
      Vault.lock();
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const toggleFingerprint = async (on: boolean) => {
    if (on) return onOpen('fingerprint');
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
        <Row title="Change master password" onPress={() => onOpen('password')} />
        <Row title="New recovery key" subtitle="Replaces the key you wrote down." onPress={() => onOpen('newKey')} />
      </Group>
      <Group title="Your passwords">
        <Row title="Import from Google" subtitle="Move your saved passwords out of Google Password Manager." onPress={() => onOpen('import')} />
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
