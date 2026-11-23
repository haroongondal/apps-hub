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

import type { KillSwitchStatus, NetworkInfo } from 'open-tunnel-native';
import type { TunnelSettings } from '../data/settings-store.ts';
import { lockdownHint } from '../tunnel/kill-switch.ts';
import { describeNetwork, isTrusted, trustNetwork } from '../tunnel/trusted-wifi.ts';

export interface SettingsSheetProps {
  visible: boolean;
  onClose(): void;
  settings: TunnelSettings;
  killSwitch: KillSwitchStatus;
  /** The phone's own network while Trusted Wi-Fi watches it; null otherwise. */
  network: NetworkInfo | null;
  trustedWifiError: string | null;
  onChangeTrustedWifi(enabled: boolean): void;
  onTrustNetwork(): void;
  onForgetNetwork(ssid: string): void;
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
    return 'iPhone reconnects the VPN by itself and keeps traffic inside it while this is on.';
  }
  return 'If the VPN drops, TunnelWall blocks internet until a relay connects or you stop blocking.';
}

export function SettingsSheet({
  visible,
  onClose,
  settings,
  killSwitch,
  network,
  trustedWifiError,
  onChangeTrustedWifi,
  onTrustNetwork,
  onForgetNetwork,
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
        title="When the VPN drops"
        footer="Applies on the next connect. Changing it does not alter a running connection."
      >
        <Row
          title="Block internet while the VPN is off"
          subtitle={killSwitchDetail(Platform.OS)}
          trailing={
            <Segmented
              options={KILL_SWITCH_OPTIONS}
              value={settings.killSwitchEnabled ? 'on' : 'off'}
              onChange={(key) => onChangeKillSwitch(key === 'on')}
              accessibilityLabel="Block internet while the VPN is off"
            />
          }
        />
        {Platform.OS === 'android' ? (
          <Row
            {...lockdownHint(killSwitch)}
            onPress={onOpenSystemSettings}
            accessibilityHint="Opens Android's VPN settings"
          />
        ) : (
          <Row
            title="VPN settings"
            subtitle="Opens the settings for TunnelWall"
            onPress={onOpenSystemSettings}
            accessibilityHint="Opens the system settings"
          />
        )}
      </Group>

      {Platform.OS === 'android' && (
        <Group
          title="Trusted Wi-Fi"
          footer="Off unless you turn it on. When on, TunnelWall connects to the best relay by itself on any network that is not a trusted Wi-Fi, while TunnelWall is open or connected. Wi-Fi names stay on this phone."
        >
          {Number(Platform.Version) < 31 ? (
            <Row title="Connect on other networks" subtitle="Needs Android 12 or newer." />
          ) : (
            <Row
              title="Connect on other networks"
              subtitle="Turning this on asks for precise location: Android shows the Wi-Fi name only to apps that have it."
              trailing={
                <Segmented
                  options={KILL_SWITCH_OPTIONS}
                  value={settings.trustedWifiEnabled ? 'on' : 'off'}
                  onChange={(key) => onChangeTrustedWifi(key === 'on')}
                  accessibilityLabel="Connect on networks that are not trusted"
                />
              }
            />
          )}
          {trustedWifiError !== null && (
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
              <Notice tone="warn">{trustedWifiError}</Notice>
            </View>
          )}
          {settings.trustedWifiEnabled && (
            <Row
              title="This network"
              subtitle={describeNetwork(network, settings.trustedNetworks)}
              trailing={
                network !== null &&
                !isTrusted(network, settings.trustedNetworks) &&
                trustNetwork(network, settings.trustedNetworks) !== null ? (
                  <Button label="Trust" variant="secondary" size="sm" onPress={onTrustNetwork} />
                ) : undefined
              }
            />
          )}
          {settings.trustedNetworks.map((entry) => (
            <Row
              key={entry.ssid}
              title={entry.ssid}
              subtitle={entry.bssids.length === 1 ? 'Trusted on 1 access point' : `Trusted on ${entry.bssids.length} access points`}
              trailing={<Button label="Forget" variant="danger" size="sm" onPress={() => onForgetNetwork(entry.ssid)} />}
            />
          ))}
        </Group>
      )}

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
                <Button label="Remove" variant="danger" size="sm" onPress={() => onRemoveDisallowedApp(app)} />
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
