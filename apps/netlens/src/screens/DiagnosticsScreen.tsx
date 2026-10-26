/**
 * DiagnosticsScreen — FR-3 / AC-4 (Phase 4). Runs the Phase 2 engine stack:
 * PingEngine over the three SPEC §5 hops + DnsBenchmark, then renders the
 * per-hop groups (RTT / jitter / loss) and the plain-English verdict.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import {
  Button,
  Empty,
  Group,
  Header,
  Notice,
  Pill,
  Progress,
  Readout,
  Row,
  Screen,
  Text,
  space,
} from '@apps-hub/ui';

import {
  DEFAULT_DIAGNOSTIC_THRESHOLDS,
  DnsBenchmark,
  PingEngine,
  diagnose,
  isDnsSlow,
  isGatewayDegraded,
  isWanDegraded,
  summarizeWan,
  type DnsBenchmarkResult,
  type HopMetrics,
  type PingHopName,
  type PingReport,
} from '@apps-hub/core';
import { createNetLensNativeBinding } from 'netlens-core';

type Phase = 'idle' | 'running' | 'done' | 'error';

interface RunOutput {
  report: PingReport;
  dns: DnsBenchmarkResult;
}

const HOP_NAMES: Record<PingHopName, string> = {
  gateway: 'Router',
  wan_cloudflare: 'Cloudflare',
  wan_google: 'Google',
};

function fmt(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function unreachable(metrics: { avgRttMs: number | null; packetLossPct: number }): boolean {
  return metrics.avgRttMs === null && metrics.packetLossPct >= 100;
}

function StatusPill({ dead, slow }: { dead: boolean; slow: boolean }) {
  if (dead) return <Pill label="No reply" tone="danger" />;
  if (slow) return <Pill label="Slow" tone="warn" />;
  return <Pill label="Good" tone="ok" />;
}

function Readouts({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>{children}</View>;
}

export default function DiagnosticsScreen() {
  const bindingProxy = useRef(createNetLensNativeBinding()).current;
  const [phase, setPhase] = useState<Phase>('idle');
  const [output, setOutput] = useState<RunOutput | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const runDiagnostics = useCallback(async (): Promise<void> => {
    if (phase === 'running') return;
    setPhase('running');
    setNote(null);
    setOutput(null);
    try {
      const ping = new PingEngine(bindingProxy);
      const dns = new DnsBenchmark(bindingProxy);
      // SPEC §5: sequential bursts, gateway → 1.1.1.1 → 8.8.8.8, then DNS.
      const [report, dnsResult] = await Promise.all([
        ping.pingAll(),
        dns.benchmark().catch((): DnsBenchmarkResult => ({
          hostname: 'example.com',
          resolveMs: null,
          addresses: [],
          success: false,
          attemptCount: 3,
          attemptDurationsMs: [],
        })),
      ]);
      setOutput({ report, dns: dnsResult });
      setPhase('done');
    } catch (error: unknown) {
      setNote(error instanceof Error ? error.message : String(error));
      setPhase('error');
    }
  }, [bindingProxy, phase]);

  const gateway: HopMetrics | null = output?.report.gateway?.metrics ?? null;
  const wanResults = useMemo(
    () => (output ? output.report.hops.filter((hop) => hop.hop !== 'gateway') : []),
    [output],
  );
  const wanHops = useMemo(() => wanResults.map((hop) => hop.metrics), [wanResults]);
  const wan = summarizeWan(wanHops);
  const dnsMs = output?.dns.resolveMs ?? null;
  const verdict =
    output !== null
      ? diagnose({ gateway, wan: wanHops, dnsResolveMs: dnsMs })
      : null;

  const running = phase === 'running';

  useEffect(() => {
    if (verdict !== null) AccessibilityInfo.announceForAccessibility(verdict.title);
  }, [verdict?.title]);

  return (
    <Screen scroll>
      <Header
        title="Diagnostics"
        subtitle="Find out whether a slow connection comes from your Wi-Fi, your internet provider or DNS."
      />

      <View style={{ gap: space.md }}>
        <Button
          label={running ? 'Measuring' : output !== null ? 'Run again' : 'Run diagnostics'}
          block
          busy={running}
          onPress={runDiagnostics}
          accessibilityHint="Measures your router, the internet path and DNS"
        />
        {running ? (
          <View style={{ gap: space.sm }}>
            <Progress value={null} />
            <Text variant="meta" tone="muted" accessibilityLiveRegion="polite">
              Measuring your router, then the internet, then DNS
            </Text>
          </View>
        ) : null}
      </View>

      {note !== null ? (
        <Notice tone="danger" title="Diagnostics didn't finish">
          {`${note} Check that you're connected to Wi-Fi, then run again.`}
        </Notice>
      ) : null}

      {output === null && !running && note === null ? (
        <Empty
          title="Check where your connection slows down"
          body="NetLens times your router, two internet servers and a DNS lookup, then tells you which one is the bottleneck."
        />
      ) : null}

      {output !== null && verdict !== null ? (
        <>
          <Notice tone={verdict.verdict === 'HEALTHY' ? 'ok' : 'warn'} title={verdict.title}>
            <Text variant="meta">{verdict.advice}</Text>
            {verdict.reasons.map((reason) => (
              <Text key={reason} variant="data" tone="muted">
                {reason}
              </Text>
            ))}
          </Notice>

          <Group
            title="Wi-Fi to router"
            trailing={
              gateway === null ? (
                <Pill label="Skipped" />
              ) : (
                <StatusPill
                  dead={unreachable(gateway)}
                  slow={isGatewayDegraded(gateway, DEFAULT_DIAGNOSTIC_THRESHOLDS)}
                />
              )
            }
          >
            {gateway === null ? (
              <Row title="No router found" subtitle="NetLens couldn't detect your router, so this step was skipped." />
            ) : (
              <Row title={
                <Readouts>
                  <Readout value={fmt(gateway.avgRttMs)} unit="ms" label="Average" />
                  <Readout value={fmt(gateway.jitterMs)} unit="ms" label="Jitter" />
                  <Readout value={gateway.packetLossPct.toFixed(1)} unit="%" label="Lost" />
                </Readouts>
              } />
            )}
            {output.report.gateway !== null ? (
              <Row title="Router" subtitle={output.report.gateway.targetIp} mono />
            ) : null}
          </Group>

          <Group
            title="Router to internet"
            trailing={
              <StatusPill
                dead={unreachable(wan)}
                slow={isWanDegraded(wanHops, DEFAULT_DIAGNOSTIC_THRESHOLDS)}
              />
            }
            footer="Speed is judged on the faster server, loss on the worse one."
          >
            {unreachable(wan) ? (
              <Row title="No internet server answered" subtitle="Your router may be offline. Restart it and run again." />
            ) : (
              <Row title={
                <Readouts>
                  <Readout value={fmt(wan.avgRttMs)} unit="ms" label="Fastest path" />
                  <Readout value={wan.packetLossPct.toFixed(1)} unit="%" label="Lost" />
                </Readouts>
              } />
            )}
            {wanResults.map((hop) => (
              <Row
                key={hop.hop}
                title={HOP_NAMES[hop.hop]}
                subtitle={hop.port === null ? hop.targetIp : `${hop.targetIp}:${hop.port}`}
                mono
                trailing={
                  <Text variant="data" tone={unreachable(hop.metrics) ? 'danger' : 'text'}>
                    {unreachable(hop.metrics) ? 'No reply' : `${fmt(hop.metrics.avgRttMs)} ms`}
                  </Text>
                }
              />
            ))}
          </Group>

          <Group
            title="DNS lookup"
            trailing={
              <StatusPill
                dead={dnsMs === null}
                slow={isDnsSlow(dnsMs, DEFAULT_DIAGNOSTIC_THRESHOLDS)}
              />
            }
          >
            {dnsMs === null ? (
              <Row
                title={`Couldn't look up ${output.dns.hostname}`}
                subtitle={`All ${output.dns.attemptCount} attempts failed. Check your router's DNS settings.`}
              />
            ) : (
              <Row title={<Readout value={fmt(dnsMs)} unit="ms" label="Average lookup" />} />
            )}
            <Row title="Looked up" subtitle={output.dns.hostname} mono />
            {output.dns.addresses.length > 0 ? (
              <Row title="Answers" subtitle={output.dns.addresses.join('\n')} mono />
            ) : null}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}
