import React, { useEffect, useState } from 'react';
import { PermissionsAndroid, Platform, Linking, Switch, View } from 'react-native';
import { Button, Group, Header, Notice, Pill, Row, Screen, Segmented, space, useTheme } from '@apps-hub/ui';
import Vault, { type Diagnostics, type Status } from 'strongroom-vault';
import { isLocked, messageOf } from './call.ts';
import { emailRecoveryView } from './recovery-flow.ts';
import { SyncSettingsRow } from './SyncScreen.tsx';
import { useEmailRecovery } from './useEmailRecovery.ts';

const MINUTES = [
  { key: '1', label: '1 minute' },
  { key: '5', label: '5 minutes' },
  { key: '15', label: '15 minutes' },
] as const;

const LABELS = [
  { key: 'dates', label: 'Dates only' },
  { key: 'names', label: 'Show names' },
] as const;

const BROWSERS: Record<string, string> = { 'com.android.chrome': 'Chrome', 'org.mozilla.firefox': 'Firefox' };

const MIUI = (() => {
  try {
    return String((Platform.constants as unknown as { Manufacturer?: string }).Manufacturer).toLowerCase() === 'xiaomi';
  } catch {
    return false;
  }
})();

export type SettingsFlow = 'password' | 'fingerprint' | 'newKey' | 'import' | 'authenticator' | 'sync' | 'emailRecovery' | 'export' | 'imports' | 'deleteAll' | 'check';

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
  const email = useEmailRecovery().status;
  const emailTitle = email ? emailRecoveryView(email).title : undefined;

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

  const toggleKeepAlive = async (on: boolean) => {
    try {
      // A denied request still enables the service; only the status icon is hidden then.
      if (on && Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      Vault.setKeepAlive(on);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const toggleSmsFill = async (on: boolean) => {
    try {
      // Without the permission the phone never delivers the message, so a denied request leaves the toggle off.
      if (on) {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
      Vault.setSmsFill(on);
      refresh();
    } catch (e) {
      fail(e);
    }
  };

  const setExpiryShare = (on: boolean, names: boolean) => {
    try {
      Vault.setExpiryShare(on, names);
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
      <Group title="Autofill keep-alive" footer="Keeps Strongroom ready to fill while other apps use password fields. Turning it off removes the ongoing status icon.">
        <Row
          title="Keep autofill ready"
          subtitle="Fills arrive right away, even after the phone has been idle."
          trailing={
            <Switch
              value={status.keepAliveEnabled}
              onValueChange={toggleKeepAlive}
              accessibilityLabel="Keep autofill ready"
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor={c.surface}
            />
          }
        />
      </Group>
      <Group title="Text messages" footer="Strongroom reads incoming text messages only to find verification codes, and keeps nothing.">
        <Row
          title="Fill codes from text messages"
          subtitle="A code that arrives shows as a suggestion in the verification field."
          trailing={
            <Switch
              value={status.smsFillEnabled}
              onValueChange={toggleSmsFill}
              accessibilityLabel="Fill codes from text messages"
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor={c.surface}
            />
          }
        />
      </Group>
      {MIUI && (
        <Group title="Xiaomi battery" footer="HyperOS can still freeze Strongroom despite the keep-alive service.">
          <Row
            title="Open app settings"
            subtitle="Set Strongroom's battery saver to No restrictions, or password fills can time out."
            onPress={() => {
              try {
                Linking.openSettings();
              } catch (e) {
                fail(e);
              }
            }}
          />
        </Group>
      )}
      <Group title="Master password and recovery key">
        <Row title="Change master password" onPress={() => onOpen('password')} />
        <Row title="New recovery key" subtitle="Replaces the key you wrote down." onPress={() => onOpen('newKey')} />
        <Row title="Email recovery" subtitle={emailTitle === 'Email recovery' ? undefined : emailTitle} onPress={() => onOpen('emailRecovery')} />
      </Group>
      <Group title="Sync">
        <SyncSettingsRow onOpen={() => onOpen('sync')} />
      </Group>
      <Group title="Your passwords">
        <Row title="Password check" subtitle="Find passwords that are reused, easy to guess or well known." onPress={() => onOpen('check')} />
        <Row title="Import from Google" subtitle="Move your saved passwords out of Google Password Manager." onPress={() => onOpen('import')} />
        <Row title="Import from Google Authenticator" subtitle="Move your authenticator codes into Strongroom." onPress={() => onOpen('authenticator')} />
        <Row title="Imported files" subtitle="Delete what one import brought in." onPress={() => onOpen('imports')} />
        <Row title="Export all" subtitle="Save every login, card and note to a file." onPress={() => onOpen('export')} />
        <Row title="Delete all passwords" subtitle="Empty the vault." onPress={() => onOpen('deleteAll')} />
      </Group>
      <Group
        title="Your other apps"
        footer={
          status.expiryShare
            ? status.expiryNames
              ? 'Your other Haroon apps see each card or pass name you typed and when it runs out, even while Strongroom is locked. Never numbers, codes, security codes or passwords.'
              : 'Your other Haroon apps see only "Card" or "Pass" and when each one runs out, even while Strongroom is locked. Never names, numbers, codes, security codes or passwords.'
            : 'Off: your other apps see nothing from Strongroom except that it is installed and when it last ran.'
        }
      >
        <Row
          title="Share expiry dates with my other Haroon apps"
          subtitle="So a reminder app can tell you before a card or pass runs out."
          trailing={
            <Switch
              value={status.expiryShare}
              onValueChange={(on) => setExpiryShare(on, status.expiryNames)}
              accessibilityLabel="Share expiry dates with my other Haroon apps"
              trackColor={{ false: c.line, true: c.accent }}
              thumbColor={c.surface}
            />
          }
        />
        {status.expiryShare && (
          <View style={{ padding: space.md }}>
            <Segmented
              options={LABELS}
              value={status.expiryNames ? 'names' : 'dates'}
              onChange={(key) => setExpiryShare(true, key === 'names')}
              accessibilityLabel="What your other apps see for each card or pass"
            />
          </View>
        )}
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
