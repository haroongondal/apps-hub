import React from 'react';
import { Group, Header, Screen } from '@apps-hub/ui';
import type { Quad, Settings } from 'halo-engine';
import { BackButton, Stepper, SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

// Same order as the settings document: corners top left, top right, bottom right, bottom left; insets left, top, right, bottom.
const CORNERS = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const INSETS = ['Left', 'Top', 'Right', 'Bottom'];
const put = (q: Quad, i: number, v: number) => q.map((x, j) => (j === i ? v : x)) as Quad;

export default function EdgesScreen({ settings, update, onBack }: { settings: Settings; update: UpdateSettings; onBack: () => void }) {
  const e = settings.edges;
  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Screen edges" subtitle="Fit the lights to your screen when they sit too far in or are cut off." />
      <Group>
        <SwitchRow title="Match my screen" subtitle="Use the corner shape the phone reports." value={e.auto} onChange={(auto) => update({ edges: { auto } })} />
      </Group>
      {!e.auto && (
        <>
          <Group title="Corner size">
            {CORNERS.map((label, i) => (
              <Stepper key={label} label={label} value={e.corners[i]} min={0} max={400} step={4} onChange={(v) => update({ edges: { corners: put(e.corners, i, v) } })} />
            ))}
          </Group>
          <Group title="Distance from each edge">
            {INSETS.map((label, i) => (
              <Stepper key={label} label={label} value={e.insets[i]} min={0} max={200} step={4} onChange={(v) => update({ edges: { insets: put(e.insets, i, v) } })} />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}
