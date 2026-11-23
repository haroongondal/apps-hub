import React from 'react';
import { Group, Header, Notice, Screen } from '@apps-hub/ui';
import type { Settings } from 'halo-engine';
import { BackButton, SwitchRow } from './Stepper.tsx';
import type { UpdateSettings } from './useSettings.ts';

export default function LinksScreen({ settings, update, onBack }: { settings: Settings; update: UpdateSettings; onBack: () => void }) {
  const l = settings.links;
  const set = (patch: Partial<Settings['links']>) => update({ links: patch });
  const needsScreen = !settings.aod.enabled && (l.waitingAod || l.briefing);

  return (
    <Screen scroll>
      <BackButton onPress={onBack} />
      <Header title="Your other apps" subtitle="Halo reads from TunnelWall, HomeNet, Inflow and Deputy only while a switch here is on. Nothing leaves your phone." />
      {needsScreen && (
        <Notice tone="warn" title="The always-on screen is off">
          Turn it on in the Screen tab to see these rows.
        </Notice>
      )}
      <Group title="Safety" footer="TunnelWall's Shields switch must be on too.">
        <SwitchRow
          title="Red pulse when a network may not be safe"
          subtitle="The edge pulses red while TunnelWall sees a network you do not trust, or HomeNet finds a new device on your Wi-Fi."
          value={l.shieldPulse}
          onChange={(shieldPulse) => set({ shieldPulse })}
        />
      </Group>
      <Group title="Waiting" footer="Waiting means suggestions in Inflow, and requests and drafts in Deputy.">
        <SwitchRow
          title="Pulse while something waits"
          subtitle="A slow amber pulse every 10 minutes. Quiet hours from Alerts apply."
          value={l.waitingPulse}
          onChange={(waitingPulse) => set({ waitingPulse })}
        />
        <SwitchRow
          title="Waiting on the always-on screen"
          subtitle="How many things wait and up to three short titles. Amounts are never shown."
          value={l.waitingAod}
          onChange={(waitingAod) => set({ waitingAod })}
        />
        <SwitchRow
          title="Waiting bubble"
          subtitle="A small bubble with the count over other apps. Tap it to open the app, drag it to move it."
          value={l.bubble}
          onChange={(bubble) => set({ bubble })}
        />
      </Group>
      <Group title="Briefing" footer="Anyone who picks up your phone can read the always-on screen.">
        <SwitchRow
          title="Briefing on the always-on screen"
          subtitle="Inflow's short lines for the day, such as bills and to-dos. Medicine and steps stay hidden."
          value={l.briefing}
          onChange={(briefing) => set({ briefing })}
        />
        {l.briefing && (
          <SwitchRow
            title="Show private briefing lines on the always-on screen"
            subtitle="Also shows medicine and steps, and how many people are home (never their names)."
            value={l.briefingPrivate}
            onChange={(briefingPrivate) => set({ briefingPrivate })}
          />
        )}
      </Group>
    </Screen>
  );
}
