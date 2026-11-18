import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Group, Header, Pill, Row, Screen } from '@apps-hub/ui';
import HaloEngine, { type Settings, type Status } from 'halo-engine';
import { setupRows } from './setup.ts';
import { BackButton, SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

type Switches = 'fullscreen' | 'landscape' | 'calls' | 'batterySaver' | 'pocket';

const RULES: ReadonlyArray<{ key: Switches; title: string; subtitle: string }> = [
  { key: 'fullscreen', title: 'Full screen', subtitle: 'Videos, games and other apps that hide the status bar.' },
  { key: 'landscape', title: 'Landscape', subtitle: 'While the phone is turned on its side.' },
  { key: 'calls', title: 'Calls', subtitle: 'While a call rings or is in progress.' },
  { key: 'batterySaver', title: 'Battery saver', subtitle: 'While battery saver is on.' },
  { key: 'pocket', title: 'In a pocket', subtitle: 'While something covers the top of the screen.' },
];

export default function RulesScreen({ settings, update, onBack, onPickApps }: { settings: Settings; update: UpdateSettings; onBack: () => void; onPickApps: () => void }) {
  const [status, setStatus] = useState<Status>(() => HaloEngine.getStatus());
  useEffect(() => {
    const sub = HaloEngine.addStatusListener(setStatus);
    const app = AppState.addEventListener('change', (s) => s === 'active' && setStatus(HaloEngine.getStatus()));
    return () => {
      sub.remove();
      app.remove();
    };
  }, []);

  const r = settings.rules;
  const usage = setupRows(status, settings).find((row) => row.key === 'usage');
  const count = r.apps.length;

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="When to hide the lights" subtitle="The lights go out in these cases and come back after." />
      <Group>
        {RULES.map((rule) => (
          <SwitchRow key={rule.key} title={rule.title} subtitle={rule.subtitle} value={r[rule.key]} onChange={(v) => update({ rules: { [rule.key]: v } })} />
        ))}
      </Group>
      <Group footer={usage && !usage.done ? 'Halo needs usage access to see which app is open.' : undefined}>
        <Row title="Hide over these apps" subtitle={count === 0 ? 'None chosen' : count === 1 ? '1 app' : `${count} apps`} onPress={onPickApps} />
        {usage && !usage.done && (
          <Row title={usage.label} trailing={<Pill label="Recommended" tone="warn" />} onPress={() => HaloEngine.openPermission('usage')} />
        )}
      </Group>
    </Screen>
  );
}
