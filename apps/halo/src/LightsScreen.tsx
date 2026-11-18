import React, { useMemo } from 'react';
import { Button, Group, Header, Pill, Row, Screen } from '@apps-hub/ui';
import HaloEngine, { type PatternFamily, type PatternInfo, type Settings } from 'halo-engine';
import { Stepper, SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

const tenths = (v: number) => String(Math.round(v * 10));
const percent = (v: number) => `${Math.round(v * 100)}%`;
const familyTitle = (f: PatternFamily) => f[0].toUpperCase() + f.slice(1);

export default function LightsScreen({ settings, update, onColours }: { settings: Settings; update: UpdateSettings; onColours: () => void }) {
  const families = useMemo(() => {
    const out = new Map<PatternFamily, PatternInfo[]>();
    for (const p of HaloEngine.listPatterns()) out.set(p.family, [...(out.get(p.family) ?? []), p]);
    return [...out];
  }, []);
  const p = settings.params;
  const set = (patch: Partial<Settings['params']>) => update({ params: patch });

  return (
    <Screen scroll>
      <Header title="Lights" subtitle="Changes show on the screen edges while you are here." trailing={<Button label="Colours" variant="secondary" size="sm" onPress={onColours} accessibilityHint="Choose the light colours" />} />
      {families.map(([family, patterns]) => (
        <Group key={family} title={familyTitle(family)}>
          {patterns.map((pt) => (
            <Row
              key={pt.id}
              title={pt.name}
              trailing={pt.id === settings.pattern ? <Pill label="Selected" tone="accent" /> : undefined}
              accessibilityLabel={pt.id === settings.pattern ? `${pt.name}, selected` : pt.name}
              onPress={() => update({ pattern: pt.id })}
            />
          ))}
        </Group>
      ))}
      <Group title="Look">
        <Stepper label="Thickness" value={p.thickness} min={1} max={24} step={1} onChange={(thickness) => set({ thickness })} />
        <Stepper label="Speed" value={p.speed} min={0} max={1} step={0.1} show={tenths} onChange={(speed) => set({ speed })} />
        <Stepper label="Spread" value={p.spread} min={0} max={1} step={0.1} show={tenths} onChange={(spread) => set({ spread })} />
        <Stepper label="Glow" value={p.glow} min={0} max={1} step={0.1} show={tenths} onChange={(glow) => set({ glow })} />
        <Stepper label="Gap from the edge" value={p.padding} min={0} max={32} step={2} onChange={(padding) => set({ padding })} />
        <Stepper label="Roundness" value={p.roundness} min={0} max={1.5} step={0.1} show={percent} onChange={(roundness) => set({ roundness })} />
      </Group>
      <Group>
        <SwitchRow title="Mirror" subtitle="Both sides move the same way." value={p.mirrored} onChange={(mirrored) => set({ mirrored })} />
        <SwitchRow title="Clockwise" subtitle="Turn off to run the other way." value={p.clockwise} onChange={(clockwise) => set({ clockwise })} />
      </Group>
    </Screen>
  );
}
