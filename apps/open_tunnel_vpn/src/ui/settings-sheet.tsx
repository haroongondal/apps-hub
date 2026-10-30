/**
 * Settings sheet (phase-4 plan §6). The kill switch is the engine's
 * in-app packet blocking plus the system deep link — the Android-only
 * packet-bypass API is never referenced. On iOS the same preference is the
 * module's on-demand CONNECT posture. The disallowed-apps picker is manual
 * package-name entry (G2) and renders on Android only.
 */
import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import {
  Button,
  Field,
  Group,
  Notice,
  Row,
  Segmented,
  Sheet,
  Text,
  space,
} from '@apps-hub/ui';

import type { TunnelSettings } from '../data/settings-store.ts';

export interface SettingsSheetProps {
  visible: boolean;
  onClose(): void;
  settings: TunnelSettings;
  onChangeKillSwitch(enabled: boolean): void;
  onAddDisallowedApp(packageName: string): void;
  onRemoveDisallowedApp(packageName: string): void;
  onOpenSystemSettings(): void;
}

const KILL_SWITCH_OPTIONS = [
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
] as const;

function killSwitchDetail(platform: string): string {
  if (platform === 'ios') {
    return 'The tunnel uses the system on-demand rule to hold the connection while this is on.';
  }
  return 'The engine drops packets that try to bypass the tunnel. The system always-on switch adds OS-level blocking.';
}

export function SettingsSheet({
  visible,
  onClose,
  settings,
  onChangeKillSwitch,
  onAddDisallowedApp,
  onRemoveDisallowedApp,
  onOpenSystemSettings,
}: SettingsSheetProps) {
  const [draftApp, setDraftApp] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const addApp = () => {
    const packageName = draftApp.trim();
    if (packageName.length === 0) {
      setDraftError('Enter a package name first.');
      return;
    }
    if (/\s/.test(packageName)) {
      setDraftError('Package names contain no spaces, for example org.mozilla.firefox.');
      return;
    }
    if (settings.disallowedApps.includes(packageName)) {
      setDraftError('That package is already in the list.');
      return;
    }
    setDraftError(null);
    setDraftApp('');
    onAddDisallowedApp(packageName);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Settings">
      <Group
        title="Kill switch"
        footer="Applies on the next connect. Changing it does not alter a running tunnel."
      >
        <Row
          title="Block traffic without the tunnel"
          subtitle={killSwitchDetail(Platform.OS)}
          trailing={
            <Segmented
              options={KILL_SWITCH_OPTIONS}
              value={settings.killSwitchEnabled ? 'on' : 'off'}
              onChange={(key) => onChangeKillSwitch(key === 'on')}
              accessibilityLabel="Kill switch"
            />
          }
        />
        <Row
          title="Always-on VPN settings"
          subtitle="Opens the system screen for the OS-level switch"
          onPress={onOpenSystemSettings}
          accessibilityHint="Deep-links to the system VPN settings"
        />
      </Group>

      {Platform.OS === 'android' && (
        <Group
          title="Apps outside the tunnel"
          footer="These app ids bypass the tunnel, for example an updater that must not route through a relay. Applies on the next connect."
        >
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
            <Field
              label="Package name"
              placeholder="org.mozilla.firefox"
              value={draftApp}
              onChangeText={(value) => {
                setDraftApp(value);
                setDraftError(null);
              }}
              onSubmitEditing={addApp}
              autoCapitalize="none"
              autoCorrect={false}
              error={draftError}
            />
            <Button label="Add" variant="secondary" size="sm" onPress={addApp} />
          </View>
          {settings.disallowedApps.map((app) => (
            <Row
              key={app}
              title={app}
              mono
              trailing={
                <Button
                  label="Remove"
                  variant="danger"
                  size="sm"
                  onPress={() => onRemoveDisallowedApp(app)}
                />
              }
            />
          ))}
        </Group>
      )}

      <Group title="Privacy">
        <Row
          title="My data lives only on this phone"
          subtitle="No accounts, no analytics, and the server cache dies with the app."
        />
        <Row
          title="Free relays are not anonymous"
          subtitle="Relay operators can see the sites you visit, and VPN Gate operator terms apply. Use HTTPS sites."
        />
      </Group>

      <Notice tone="neutral" title="Open source">
        TunnelWall is free software under the GPLv2. Source:
        github.com/haroongondal/apps-hub
      </Notice>
      <Text variant="caption" tone="faint">
        The address check contacts checkip.amazonaws.com only when you tap check.
      </Text>
    </Sheet>
  );
}
