import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Button, Empty, Group, Header, Notice, Pill, Row, Screen, Text, space } from '@apps-hub/ui';
import { appHealthShare, type AppHealthRow } from '@apps-hub/app-link-contract';
import StoreInstaller from 'store-installer';
import { AUTOSTART_STEPS, SERVICES, appHealth, healthApps, needsAutostart, parseHealthRow, type Fix, type HealthApp, type Line } from './health.ts';

interface Snapshot {
  apps: HealthApp[];
  settings: { accessibility: string | null; listeners: string | null };
  reports: (AppHealthRow | null)[];
}

const TEXT_TONE = { ok: 'ok', warn: 'warn', neutral: 'muted' } as const;

async function readHealth(): Promise<Snapshot> {
  const apps = healthApps((pkg) => StoreInstaller.getInstalledVersion(pkg) !== null);
  const settings = StoreInstaller.getServiceSettings();
  const now = Date.now();
  const reports = await Promise.all(
    apps.map((a) =>
      StoreInstaller.queryHealth(appHealthShare(a.id).authority, a.packageName).then(
        (rows) => parseHealthRow(rows, a.id, now),
        () => null,
      ),
    ),
  );
  return { apps, settings, reports };
}

function openFix(fix: Fix, app: HealthApp) {
  if (fix === 'accessibility') StoreInstaller.openAccessibilitySettings();
  else StoreInstaller.openListenerSettings(app.packageName, SERVICES[app.id]?.listener ?? null);
}

const FIX_LABEL: Record<Fix, string> = { accessibility: 'Open accessibility settings', listener: 'Open notification access' };

function HealthLine({ line, app }: { line: Line; app: HealthApp }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="meta" tone={TEXT_TONE[line.tone]}>
        {line.label}
      </Text>
      {line.todo && (
        <Text variant="meta" tone="muted">
          {`What to do: ${line.todo}`}
        </Text>
      )}
      {line.fix && (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label={FIX_LABEL[line.fix]} size="sm" variant="secondary" onPress={() => openFix(line.fix!, app)} />
        </View>
      )}
    </View>
  );
}

export function HealthScreen({ names, onBack }: { names: Record<string, string>; onBack: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnap(await readHealth());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const back = <Button label="Back" variant="ghost" size="sm" onPress={onBack} />;

  return (
    <Screen scroll refreshing={loading} onRefresh={load}>
      <Header title="Setup and health" subtitle="What each of your apps needs on this phone, and whether it has it." trailing={back} />

      {snap && snap.apps.length === 0 && <Empty title="No apps installed yet" body="Install an app from Store and it shows up here." />}

      {snap && snap.apps.length > 0 && (
        <Group title="Your apps" footer="Pull down to check again after you change a setting.">
          {snap.apps.map((app, i) => {
            const name = names[app.id] ?? app.id;
            const health = appHealth(app, name, snap.settings, snap.reports[i]);
            return (
              <Row
                key={app.id}
                title={
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
                    <Text variant="bodyStrong">{name}</Text>
                    <Pill label={health.needsLook ? 'Needs a look' : 'All set'} tone={health.needsLook ? 'warn' : 'ok'} />
                  </View>
                }
              >
                {health.lines.map((line) => (
                  <HealthLine key={line.label} line={line} app={app} />
                ))}
                {needsAutostart(app) && (
                  <Notice
                    title={`Keep ${name} running`}
                    action={<Button label="Open app settings" size="sm" variant="secondary" onPress={() => StoreInstaller.openAppSettings(app.packageName)} />}
                  >
                    {`Xiaomi phones stop apps in the background. ${AUTOSTART_STEPS}`}
                  </Notice>
                )}
              </Row>
            );
          })}
        </Group>
      )}
    </Screen>
  );
}
