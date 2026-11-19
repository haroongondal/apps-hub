import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Group, Notice, Row, Segmented, Text, space } from '@apps-hub/ui';
import { apps, setAppEnabled, type AppInfo } from 'ai-hub-core';
import { BLOCKED_TEXT, STRONGROOM, lastUsedText, plainError, usageText } from './format.ts';

export function AppsGroup() {
  const [list, setList] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => apps().then(setList).catch((e) => setError(plainError(e)));
  useEffect(() => {
    refresh();
  }, []);

  const toggle = async (app: AppInfo, enabled: boolean) => {
    setError(null);
    try {
      await setAppEnabled(app.packageName, enabled);
      await refresh();
    } catch (e) {
      setError(plainError(e));
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Group title="Apps">
        {list.map((app) =>
          app.packageName === STRONGROOM ? (
            <Row key={app.packageName} title={app.label} subtitle={BLOCKED_TEXT} />
          ) : (
            <Row key={app.packageName} title={app.label} subtitle={`${usageText(app)}. ${lastUsedText(app.lastUsed, Date.now())}.`}>
              <Segmented
                accessibilityLabel={`AI for ${app.label}`}
                options={[
                  { key: 'on', label: 'On' },
                  { key: 'off', label: 'Off' },
                ]}
                value={app.enabled ? 'on' : 'off'}
                onChange={(key) => toggle(app, key === 'on')}
              />
            </Row>
          ),
        )}
      </Group>
      {list.length === 0 && <Text tone="muted">No app has used the hub yet.</Text>}
      {error && <Notice tone="danger">{error}</Notice>}
    </View>
  );
}
