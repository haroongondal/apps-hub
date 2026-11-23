import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Group, Notice, Row, Segmented, Text, space, useTheme } from '@apps-hub/ui';
import { NEW_DEVICE_HOURS, type HomeWatchSettings } from '@apps-hub/core';

import { useNetworkScan } from '../scan/ScanProvider';

function SwitchRow({ title, subtitle, value, onChange, disabled }: { title: string; subtitle: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      trailing={
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          accessibilityLabel={title}
          trackColor={{ false: c.line, true: c.accent }}
          ios_backgroundColor={c.line}
        />
      }
    />
  );
}

const HOUR_OPTIONS = NEW_DEVICE_HOURS.map((h) => ({ key: String(h), label: `${h} h` }));

export function BackgroundChecks() {
  const { homeWatch } = useNetworkScan();
  const { status, notificationsAllowed, updateHomeWatch } = homeWatch;
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (status === null) return null;
  if (!status.supported) {
    return <Notice title="Checks in the background">These checks work on Android phones only.</Notice>;
  }
  const s = status.settings;
  const change = (patch: Partial<Omit<HomeWatchSettings, 'home'>>): void => {
    setSaving(true);
    void updateHomeWatch(patch).then((problem) => {
      setNote(problem);
      setSaving(false);
    });
  };
  const where = s.home ? s.home.label : 'your home Wi-Fi';

  return (
    <View style={{ gap: space.md }}>
      <Group
        title="Checks in the background"
        footer={
          s.home
            ? `Runs only while this phone is on ${where}. Never on mobile data or another Wi-Fi.`
            : 'Turn one on while this phone is on your home Wi-Fi. HomeNet then checks only that Wi-Fi.'
        }
      >
        <SwitchRow
          title="Tell me who is home"
          subtitle="About every 15 minutes, checks only the phones you tagged, on your own Wi-Fi. A phone counts as gone after three missed checks."
          value={s.whoIsHome}
          disabled={saving}
          onChange={(whoIsHome) => change({ whoIsHome })}
        />
        <SwitchRow
          title="Tell me when a new device joins"
          subtitle="Every few hours, looks over your own Wi-Fi and tells you about a device it hasn't seen in 30 days."
          value={s.newDevices}
          disabled={saving}
          onChange={(newDevices) => change({ newDevices })}
        />
        {s.newDevices ? (
          <Row title="How often">
            <Segmented
              options={HOUR_OPTIONS}
              value={String(s.newDeviceHours)}
              onChange={(key) => change({ newDeviceHours: Number(key) })}
              accessibilityLabel="How often to look for new devices"
            />
          </Row>
        ) : null}
        <SwitchRow
          title="Share with my other Haroon apps"
          subtitle="Lets your other Haroon apps see who is home and when a new device joined. Never addresses or device names."
          value={s.share}
          disabled={saving}
          onChange={(share) => change({ share })}
        />
      </Group>
      {note !== null ? <Notice tone="danger">{note}</Notice> : null}
      {s.newDevices && !notificationsAllowed ? (
        <Notice
          tone="warn"
          title="Notifications are off"
          action={<Button label="Allow" variant="secondary" size="sm" onPress={() => change({ newDevices: true })} />}
        >
          HomeNet can't tell you about new devices until you allow its notifications.
        </Notice>
      ) : null}
      {s.whoIsHome && status.people.length === 0 ? (
        <Text variant="meta" tone="muted">
          Tag a phone on the Devices tab so HomeNet knows whose it is.
        </Text>
      ) : null}
    </View>
  );
}
