/**
 * Home screen (phase-4 plan §4): throughput from native `onTrafficUpdate`
 * deltas, the relay controls, and the on-demand public IP badge. The
 * connection shield itself lives in the docked `TunnelShield` (App.tsx
 * pins it below this scroll content); every tunnel state shown arrives
 * through the `createTunnelClient` snapshot; nothing native is duplicated
 * in this component, and no state is rendered that the native side has
 * not reported.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Group,
  Notice,
  Pill,
  Readout,
  Row,
  Text,
  useTheme,
} from '@apps-hub/ui';

import type { VpnNode } from 'open-tunnel-core';
import type { TunnelSnapshot } from '../tunnel/tunnel-client.ts';
import { countryLabel, formatBytes, formatDuration, type CountryOption } from './format.ts';
import { SMOOTHED_SAMPLE_COUNT, sparklineBars, type TrafficSample } from './traffic-samples.ts';
import { forgetPublicIp, fetchPublicIp } from './public-ip.ts';
import { useTrafficRing } from './use-traffic-ring.ts';

export interface HomeScreenProps {
  tunnel: TunnelSnapshot;
  /** Node the app last asked the client to start (label source). */
  activeNode: VpnNode | null;
  /** Cached server count in the selected country, for the sheet affordance. */
  nodeCount: number;
  countries: readonly CountryOption[];
  /** Selected country code, or null for any country. */
  country: string | null;
  onSelectCountry(code: string | null): void;
  /** Relay-list refresh in progress (manual, pull-to-refresh, or auto). */
  refreshing: boolean;
  onRefreshList(): void;
  loadError: string | null;
  /** Verbatim local (pre-start) failure wording, shown next to the
   * native error surface; null when clear. */
  actionError: string | null;
  onAutoSelect(): void;
  onOpenServers(): void;
  onOpenSettings(): void;
  onOpenSystemSettings(): void;
}

export function HomeScreen({
  tunnel,
  activeNode,
  nodeCount,
  countries,
  country,
  onSelectCountry,
  refreshing,
  onRefreshList,
  loadError,
  actionError,
  onAutoSelect,
  onOpenServers,
  onOpenSettings,
  onOpenSystemSettings,
}: HomeScreenProps) {
  const busy = tunnel.state === 'connecting' || tunnel.state === 'disconnecting';
  const live = tunnel.state === 'connected' || tunnel.state === 'reasserting' || busy;
  const { ring } = useTrafficRing(live ? tunnel.traffic : null);
  const [countryOpen, setCountryOpen] = useState(false);
  const countryName = country === null ? 'Any country' : countries.find((option) => option.code === country)?.label ?? country;
  const countryChoices: readonly { code: string | null; label: string; count: number }[] = [
    { code: null, label: 'Any country', count: countries.reduce((sum, option) => sum + option.count, 0) },
    ...countries,
  ];

  return (
    <View style={{ gap: 24 }}>
      {/* The docked `TunnelShield` carries the connection surface now, so
          this group only appears while there is throughput to show — a
          settled tunnel never leaves a dangling header behind. */}
      {live && tunnel.traffic && (
        <Group title="Throughput">
          <ThroughputRow ring={ring} traffic={tunnel.traffic} />
        </Group>
      )}

      {tunnel.state === 'error' && tunnel.message !== null && (
        <Notice tone="danger" title="Couldn't connect">
          {tunnel.message}
        </Notice>
      )}
      {actionError !== null && (
        <Notice tone="danger" title="Couldn't start the tunnel">
          {actionError}
        </Notice>
      )}
      {loadError !== null && (
        <Notice tone="warn" title="Couldn't load the server list">
          {`${loadError}. Pull down to try again.`}
        </Notice>
      )}

      <Group title="Servers" footer="Volunteers run these relays. They can see the sites you visit — use HTTPS.">
        <Row
          title="Country"
          subtitle={countryName}
          trailing={<Text variant="meta" tone="accent">{countryOpen ? 'Close' : 'Change'}</Text>}
          onPress={() => setCountryOpen((open) => !open)}
          accessibilityLabel={`Country, ${countryName}, ${countryOpen ? 'expanded' : 'collapsed'}`}
          accessibilityHint="Lists the countries that have relays"
        />
        {countryOpen &&
          countryChoices.map((option) => (
            <Row
              key={option.code ?? 'any'}
              title={option.label}
              trailing={
                option.code === country ? (
                  <Pill label="Selected" tone="ok" />
                ) : (
                  <Text variant="meta" tone="muted">{`${option.count} relays`}</Text>
                )
              }
              onPress={() => {
                onSelectCountry(option.code);
                setCountryOpen(false);
              }}
              accessibilityLabel={`${option.label}, ${option.count} relays`}
            />
          ))}
        <Row
          title="Choose a server"
          subtitle={
            activeNode && live
              ? `${countryLabel(activeNode)} · ${activeNode.hostName}`
              : 'Browse the cached VPN Gate relays'
          }
          trailing={<Pill label={`${nodeCount} cached`} tone="accent" />}
          onPress={busy ? undefined : onOpenServers}
          accessibilityHint="Opens the filterable server list"
        />
        {/* Refresh keeps its own warn accent so an in-flight VPN Gate
            fetch never reads like a scan or a plain secondary action; the
            spinner carries the in-flight state, so the button stays
            enabled and a second tap re-enters the same guarded path. */}
        <Row
          title="Refresh relay list"
          subtitle="Fetches a fresh VPN Gate list and re-measures every relay"
          trailing={
            <Button
              label="Refresh"
              variant="secondary"
              size="sm"
              tone="warn"
              busy={refreshing}
              onPress={onRefreshList}
            />
          }
        />
        <Row
          title="Auto-select fastest"
          subtitle={
            country === null
              ? 'Measures the cached relays and connects to the best score'
              : `Measures the relays in ${countryName} and connects to the best score`
          }
          trailing={
            <Button
              label="Scan"
              variant="primary"
              size="sm"
              disabled={busy || nodeCount === 0}
              onPress={onAutoSelect}
            />
          }
        />
        <PublicIpRow tunnelState={tunnel.state} />
      </Group>

      <Group title="Settings">
        <Row
          title="Settings"
          subtitle="Kill switch, apps outside the tunnel, and privacy notes"
          onPress={onOpenSettings}
          accessibilityHint="Opens the settings sheet"
        />
      </Group>

      <Button
        label="Always-on VPN settings"
        variant="ghost"
        onPress={onOpenSystemSettings}
        accessibilityHint="Deep-links to the system VPN settings"
      />
      <Text variant="caption" tone="faint" align="center">
        TunnelWall is free software under the GPLv2. Source: github.com/haroongondal/apps-hub
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Throughput

function ThroughputRow({ ring, traffic }: {
  ring: { all(): readonly TrafficSample[]; recentAverage(count?: number): TrafficSample | null };
  traffic: { bytesIn: number; bytesOut: number; connectedDurationSec: number };
}) {
  const average = ring.recentAverage(SMOOTHED_SAMPLE_COUNT);
  const bars = sparklineBars(ring.all());
  const { c } = useTheme();
  return (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', gap: 24 }}>
        <Readout label="Down" value={formatBytes(traffic.bytesIn)} unit="/s" tone="ok" />
        <Readout label="Up" value={formatBytes(traffic.bytesOut)} unit="/s" tone="ok" />
        <Readout label="Connected" value={formatDuration(traffic.connectedDurationSec)} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40 }}>
        {bars.map((bar, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: bar.idle ? 2 : 4 + bar.height * 36,
              backgroundColor: bar.idle ? c.raised : c.ok,
              borderRadius: 1,
            }}
          />
        ))}
      </View>
      {average && (
        <Text variant="meta" tone="muted">
          {`Recent average: down ${formatBytes(average.bytesIn)}/s, up ${formatBytes(average.bytesOut)}/s`}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Public IP badge

interface IpBadgeState {
  checking: boolean;
  value: string | null;
  error: string | null;
}

function PublicIpRow({ tunnelState }: { tunnelState: TunnelSnapshot['state'] }) {
  const [badge, setBadge] = useState<IpBadgeState>({ checking: false, value: null, error: null });
  const abortRef = useRef<AbortController | null>(null);

  // The in-memory cache is dropped whenever the tunnel state changes, so a
  // connect or disconnect always re-measures on the next tap.
  useEffect(() => {
    forgetPublicIp();
    setBadge({ checking: false, value: null, error: null });
  }, [tunnelState]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const check = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBadge({ checking: true, value: null, error: null });
    try {
      const address = await fetchPublicIp(controller.signal);
      if (controller.signal.aborted) return;
      setBadge({ checking: false, value: address, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setBadge({
        checking: false,
        value: null,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const via = tunnelState === 'connected' ? 'via the tunnel' : 'direct';
  const subtitle =
    badge.error !== null
      ? badge.error
      : badge.value !== null
        ? `${badge.value} — ${via}`
        : 'Shows the address websites see. Check on demand.';

  return (
    <Row
      title="Public IP"
      subtitle={subtitle}
      trailing={
        <Button
          label="Check"
          variant="secondary"
          size="sm"
          busy={badge.checking}
          onPress={() => void check()}
        />
      }
      accessibilityHint="Fetches the public address through the current route"
    />
  );
}
