/**
 * ScannerScreen — FR-1/FR-2/FR-4 composition (Phase 4).
 * Flow: detect interface → sweep the clamped /24 (live events) →
 * enrich alive hosts with SSDP/mDNS facts → reconcile into the local
 * store → render. Custom names and trust survive rescans via the store
 * port (AC-3); unknown identities surface the NEW badge (AC-2).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, Switch, View } from 'react-native';
import {
  Button,
  Dot,
  Empty,
  Field,
  Group,
  Header,
  Notice,
  Pill,
  Progress,
  Readout,
  Row,
  Screen,
  Segmented,
  Sheet,
  Text,
  radius,
  space,
  useTheme,
} from '@apps-hub/ui';

import {
  TcpScanEngine,
  computeSubnetForHost,
  hashNetworkId,
  reconcileScan,
  type DeviceStore,
  type DiscoveredHost,
  type HostEnrichment,
  type InterfaceInfo,
  type ReconciledDevice,
  type ServiceEvent,
  type SubnetPlan,
} from '@apps-hub/core';
import { createNetLensNativeBinding } from 'netlens-core';

import { openDeviceStore } from '../db/device-store-sqlite';

type FilterKey = 'all' | 'new' | 'untrusted';
type Phase = 'idle' | 'scanning' | 'reconciling' | 'done' | 'error';

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'untrusted', label: 'Untrusted' },
];

/** Targeted-ping plan (5 samples × 250 ms; native connect-timeout cap 10 s). */
const PING_SAMPLE_COUNT = 5;
const PING_INTERVAL_MS = 250;
const PING_TIMEOUT_MS = 800;
/** mDNS/SSDP enrichment window appended around the sweep (SPEC §3.3). */
const SERVICE_DISCOVERY_MS = 4000;

/** First stored open/forwarded port, falling back to the hard-rule set. */
function detailPort(device: ReconciledDevice): number {
  const first = Number(device.openPortsCsv.split(',')[0]);
  return Number.isInteger(first) && first > 0 ? first : DEFAULT_PING_PORT;
}
const DEFAULT_PING_PORT = 80;

function deviceName(device: ReconciledDevice): string {
  return device.customName ?? device.vendorOrModel ?? device.hostname ?? device.lastIp;
}

function ms(value: number): string {
  return value.toFixed(1);
}

interface PingResult {
  ip: string;
  port: number;
  rtts: number[];
}

export default function ScannerScreen() {
  const { c } = useTheme();
  const bindingProxy = useRef(createNetLensNativeBinding()).current;
  const engineProxy = useRef(new TcpScanEngine(bindingProxy)).current;
  const storeProxy = useRef<DeviceStore | null>(null);

  const [iface, setIface] = useState<InterfaceInfo | null>(null);
  const [plan, setPlan] = useState<SubnetPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [discovered, setDiscovered] = useState(0);
  const [devices, setDevices] = useState<ReconciledDevice[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciledDevice | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [trustDraft, setTrustDraft] = useState(false);
  const [pingTargetBusy, setPingTargetBusy] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [mdnsTypes, setMdnsTypes] = useState<string[]>([]);
  const [storeReady, setStoreReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openDeviceStore()
      .then((store) => {
        if (cancelled) return;
        storeProxy.current = store;
        setStoreReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrorNote(`NetLens could not open its device list on this phone: ${e instanceof Error ? e.message : String(e)}`);
      });
    bindingProxy.detectInterface().then((info) => {
      if (!cancelled) setIface(info);
    });
    return () => {
      cancelled = true;
    };
  }, [bindingProxy]);

  const scanning = phase === 'scanning' || phase === 'reconciling';
  const totalTargets = plan?.hosts.length ?? 254;

  const runScan = useCallback(async () => {
    const store = storeProxy.current;
    if (!store || scanning) return;
    setErrorNote(null);
    setDiscovered(0);
    setPhase('scanning');
    try {
      const info = await bindingProxy.detectInterface();
      setIface(info);
      if (!info) {
        throw new Error("This phone isn't connected to a Wi-Fi network.");
      }
      const planned = computeSubnetForHost(info.localIp, info.cidrPrefix);
      setPlan(planned);

      // Enrichment buffers, filled by native events while the sweep runs.
      const ssdpByIp = new Map<string, { usn: string | null; vendor: string | null }>();
      const mdns = new Set<string>();
      const collectedTargets: DiscoveredHost[] = [];

      const serviceHandle = bindingProxy.addListener(
        'onServiceDiscovered',
        (event: ServiceEvent): void => {
          if (event.kind === 'mdns' && typeof event.serviceName === 'string') {
            mdns.add(event.serviceName);
            return;
          }
          if (typeof event.host === 'string' && event.host) {
            ssdpByIp.set(event.host, {
              usn: typeof event.usn === 'string' ? event.usn : null,
              vendor: typeof event.server === 'string' ? event.server : null,
            });
          }
        },
      );
      const hostHandle = bindingProxy.addListener(
        'onHostDiscovered',
        (host: DiscoveredHost): void => {
          collectedTargets.push(host);
          if (host.isReachable) {
            setDiscovered((count) => Math.min(count + 1, planned.hosts.length));
          }
        },
      );

      try {
        const [scanSummary] = await Promise.all([
          engineProxy.scanOnce({ requestedPrefix: info.cidrPrefix }),
          engineProxy.discoverServices(SERVICE_DISCOVERY_MS),
        ]);

        setMdnsTypes([...mdns].sort());
        setPhase('reconciling');

        const reachable = scanSummary.discovered.filter((entry) => entry.isReachable);
        const enrichment: Record<string, HostEnrichment> = {};
        for (const entry of reachable) {
          const facts = ssdpByIp.get(entry.ip) ?? null;
          enrichment[entry.ip] = {
            usn: facts?.usn ?? null,
            vendorOrModel: facts?.vendor ?? null,
          };
        }
        const result = await reconcileScan(
          {
            networkId: hashNetworkId(info.gatewayIp ?? info.localIp, planned.prefix),
            gatewayIp: info.gatewayIp,
            subnetCidr: `${planned.networkIp}/${planned.prefix}`,
            // Prefer the engine's collected set; the parallel-collected copy
            // is a live mirror used only for the progress counter.
            hosts: reachable.length > 0 ? reachable : collectedTargets,
            enrichmentByIp: enrichment,
          },
          store,
        );
        setDevices(result.devices);
        setPhase('done');
      } finally {
        serviceHandle.remove();
        hostHandle.remove();
      }
    } catch (error: unknown) {
      setErrorNote(error instanceof Error ? error.message : String(error));
      setPhase('error');
    }
  }, [bindingProxy, engineProxy, scanning]);

  const stopScan = useCallback(async () => {
    await Promise.allSettled([
      engineProxy.stop(),
      engineProxy.stopServiceDiscovery(),
    ]);
  }, [engineProxy]);

  const activeCount = useMemo(
    () => devices.filter((row) => row.seenThisScan).length,
    [devices],
  );
  const newBadgeCount = useMemo(
    () => devices.filter((row) => row.isNew).length,
    [devices],
  );
  const visible = useMemo(() => {
    if (filter === 'new') return devices.filter((row) => row.isNew);
    if (filter === 'untrusted') return devices.filter((row) => !row.isTrusted);
    return devices;
  }, [devices, filter]);

  // iOS has no live regions, so the finished result is announced explicitly.
  useEffect(() => {
    if (phase === 'done') {
      AccessibilityInfo.announceForAccessibility(
        `Scan finished. ${activeCount} devices responding, ${newBadgeCount} new.`,
      );
    }
  }, [phase, activeCount, newBadgeCount]);

  const openDetail = useCallback((device: ReconciledDevice): void => {
    setDetail(device);
    setNameDraft(device.customName ?? '');
    setTrustDraft(device.isTrusted);
    setPingResult(null);
  }, []);

  const saveDetail = useCallback(async (): Promise<void> => {
    const store = storeProxy.current;
    if (!store || detail === null) return;
    const updated: ReconciledDevice = {
      ...detail,
      customName: nameDraft.trim() || null,
      isTrusted: trustDraft,
    };
    await store.updateDevice(updated);
    setDevices((rows) =>
      rows.map((row) => (row.id === updated.id ? updated : row)),
    );
    setDetail(null);
  }, [detail, nameDraft, trustDraft]);

  const pingTarget = useCallback(async (): Promise<void> => {
    if (detail === null || pingTargetBusy) return;
    setPingTargetBusy(true);
    setPingResult(null);
    try {
      const port = detailPort(detail);
      const rtts: number[] = [];
      for (let index = 0; index < PING_SAMPLE_COUNT; index += 1) {
        if (index > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, PING_INTERVAL_MS));
        }
        const measurement = await bindingProxy.measureTcpHandshake(
          detail.lastIp,
          port,
          PING_TIMEOUT_MS,
        );
        if (measurement.rttMs !== null) rtts.push(measurement.rttMs);
      }
      setPingResult({ ip: detail.lastIp, port, rtts });
    } finally {
      setPingTargetBusy(false);
    }
  }, [bindingProxy, detail, pingTargetBusy]);

  const subnet = plan ? `${plan.networkIp}/${plan.prefix}` : null;
  const hasScanned = phase !== 'idle' || devices.length > 0;

  const header = (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.lg, gap: space.xl }}>
      <Header
        title="Your network"
        subtitle={
          <Text variant="meta" tone="muted">
            {iface ? (
              <>
                {'This phone '}
                <Text variant="data" tone="text">{iface.localIp}</Text>
                {iface.gatewayIp ? (
                  <>
                    {', router '}
                    <Text variant="data" tone="text">{iface.gatewayIp}</Text>
                  </>
                ) : null}
              </>
            ) : (
              'Looking for your Wi-Fi connection'
            )}
          </Text>
        }
      />

      {hasScanned && phase !== 'error' ? (
        <View style={{ gap: space.md }}>
          <View accessibilityLiveRegion="polite">
            <Readout
              value={String(scanning ? discovered : activeCount)}
              label={scanning ? 'devices answered so far' : 'devices responding'}
              tone={scanning ? 'accent' : undefined}
            />
          </View>
          {subnet ? (
            <Text variant="data" tone="muted">
              {subnet}
            </Text>
          ) : null}
          {scanning ? (
            <View style={{ gap: space.sm }}>
              <Progress value={null} />
              <Text variant="meta" tone="muted" accessibilityLiveRegion="polite">
                {phase === 'reconciling'
                  ? "Matching against devices you've seen before"
                  : `Checking up to ${totalTargets} addresses for a reply`}
              </Text>
            </View>
          ) : (
            <Text variant="meta" tone="muted">
              {`${newBadgeCount} new, ${devices.length} remembered on this network`}
            </Text>
          )}
        </View>
      ) : null}

      {errorNote !== null ? (
        <Notice
          tone="danger"
          title="The scan didn't finish"
          action={<Button label="Try again" variant="secondary" size="sm" onPress={runScan} />}
        >
          {`${errorNote} Check that Wi-Fi is on and connected, then try again.`}
        </Notice>
      ) : null}

      {scanning ? (
        <Button
          label="Stop scan"
          variant="secondary"
          block
          onPress={stopScan}
          accessibilityHint="Stops checking addresses and keeps what was found"
        />
      ) : (
        <Button
          label={hasScanned ? 'Scan again' : 'Scan network'}
          block
          onPress={runScan}
          disabled={!storeReady}
          accessibilityHint="Looks for devices on your Wi-Fi"
        />
      )}

      {devices.length > 0 ? (
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          accessibilityLabel="Show devices"
        />
      ) : null}
    </View>
  );

  const empty = !hasScanned ? (
    <Empty
      title="Find the devices on your Wi-Fi"
      body="NetLens asks every address on your network for a reply. Nothing leaves your network."
    />
  ) : devices.length === 0 ? (
    scanning ? null : (
      <Empty title="No devices answered" body="Make sure you're on the right Wi-Fi network, then scan again." />
    )
  ) : filter === 'new' ? (
    <Empty title="No new devices" body="Devices that join your network for the first time show up here." />
  ) : (
    <Empty title="Every device is trusted" body="Devices you haven't marked as trusted show up here." />
  );

  const footer =
    mdnsTypes.length > 0 ? (
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl }}>
        <Group
          title="Services announced on your network"
          footer="Announced to the whole network, so they aren't tied to one device."
        >
          <Row title={<Text variant="data">{mdnsTypes.join('\n')}</Text>} />
        </Group>
      </View>
    ) : null;

  const groupEdge = { borderColor: c.line, borderLeftWidth: 1, borderRightWidth: 1, marginHorizontal: space.lg, backgroundColor: c.surface };

  return (
    <Screen>
      <FlatList
        data={visible}
        keyExtractor={(row) => `${row.identityKey}-${String(row.id ?? 0)}`}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: space.xxxl }}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => (
          <View style={groupEdge}>
            <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />
          </View>
        )}
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === visible.length - 1;
          const name = deviceName(item);
          const facts = [
            item.isNew ? 'new' : null,
            item.isTrusted ? 'trusted' : null,
            item.seenThisScan ? null : 'not seen in this scan',
          ].filter(Boolean);
          return (
            <View
              style={[
                groupEdge,
                { overflow: 'hidden' },
                first && { borderTopWidth: 1, borderTopLeftRadius: radius.group, borderTopRightRadius: radius.group },
                last && { borderBottomWidth: 1, borderBottomLeftRadius: radius.group, borderBottomRightRadius: radius.group },
              ]}
            >
              <Row
                onPress={() => openDetail(item)}
                accessibilityLabel={[name, item.lastIp, ...facts].join(', ')}
                accessibilityHint="Opens name, trust and ping for this device"
                leading={<Dot tone={item.seenThisScan ? 'ok' : 'neutral'} />}
                title={
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {name}
                  </Text>
                }
                subtitle={
                  <View style={{ gap: 2 }}>
                    <Text variant="data" tone="muted" numberOfLines={1}>
                      {item.openPortsCsv ? `${item.lastIp}:${item.openPortsCsv}` : item.lastIp}
                    </Text>
                    {item.vendorOrModel !== null && item.customName !== null ? (
                      <Text variant="meta" tone="muted" numberOfLines={1}>
                        {item.vendorOrModel}
                      </Text>
                    ) : null}
                    {!item.seenThisScan ? (
                      <Text variant="meta" tone="faint">
                        Not seen in this scan
                      </Text>
                    ) : null}
                  </View>
                }
                trailing={
                  item.isNew || item.isTrusted ? (
                    <View style={{ gap: space.xs, alignItems: 'flex-end' }}>
                      {item.isNew ? <Pill label="New" tone="accent" /> : null}
                      {item.isTrusted ? <Pill label="Trusted" tone="ok" /> : null}
                    </View>
                  ) : null
                }
              />
            </View>
          );
        }}
      />

      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        onDone={() => void saveDetail()}
        doneLabel="Save"
        title={detail ? deviceName(detail) : 'Device'}
      >
        {detail !== null ? (
          <>
            <Field
              label="Name"
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="e.g. Living room TV"
              hint="Shown instead of the address and kept across scans."
              returnKeyType="done"
            />

            <Group>
              <Row
                title="Trusted device"
                subtitle="Trusted devices are hidden from the Untrusted list."
                trailing={
                  <Switch
                    value={trustDraft}
                    onValueChange={setTrustDraft}
                    accessibilityLabel="Trusted device"
                    trackColor={{ false: c.line, true: c.accent }}
                    ios_backgroundColor={c.line}
                  />
                }
              />
            </Group>

            <Group title="Details">
              <Fact label="IP address" value={detail.lastIp} />
              {detail.openPortsCsv ? <Fact label="Open port" value={detail.openPortsCsv} /> : null}
              {detail.hostname ? <Fact label="Hostname" value={detail.hostname} /> : null}
              {detail.vendorOrModel ? <Fact label="Vendor or model" value={detail.vendorOrModel} /> : null}
              {detail.mdnsServicesCsv ? (
                <Fact label="Services" value={detail.mdnsServicesCsv.split(',').join('\n')} />
              ) : null}
              <Fact label="First seen" value={new Date(detail.firstSeenAt).toLocaleString()} plain />
              <Fact
                label="This scan"
                value={detail.seenThisScan ? 'Responded' : "Didn't respond"}
                plain
              />
            </Group>

            <View style={{ gap: space.md }}>
              <Group
                title="Response time"
                footer={`Times ${PING_SAMPLE_COUNT} connections to port ${detailPort(detail)}.`}
              >
                {pingResult !== null && pingResult.rtts.length > 0 ? (
                  <Row title={<PingReadouts rtts={pingResult.rtts} />} />
                ) : (
                  <Row
                    title={pingTargetBusy ? 'Measuring' : 'Not measured yet'}
                    subtitle={pingTargetBusy ? 'Takes a couple of seconds.' : 'Ping to see how quickly this device answers.'}
                  />
                )}
              </Group>
              {pingResult !== null && pingResult.rtts.length === 0 ? (
                <Notice tone="warn" title={`No reply from ${pingResult.ip}:${pingResult.port}`}>
                  The device may be asleep or blocking this port. Try again in a moment.
                </Notice>
              ) : null}
              <Button
                label={pingTargetBusy ? 'Pinging' : 'Ping'}
                variant="secondary"
                block
                busy={pingTargetBusy}
                onPress={pingTarget}
                accessibilityHint="Measures how quickly this device answers"
              />
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function Fact({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <Row
      title={
        <Text variant="meta" tone="muted">
          {label}
        </Text>
      }
      subtitle={
        <Text variant={plain ? 'body' : 'data'} selectable>
          {value}
        </Text>
      }
    />
  );
}

function PingReadouts({ rtts }: { rtts: number[] }) {
  const avg = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  const loss = ((PING_SAMPLE_COUNT - rtts.length) / PING_SAMPLE_COUNT) * 100;
  const cells = [
    { label: 'Average', value: ms(avg), unit: 'ms' },
    { label: 'Fastest', value: ms(Math.min(...rtts)), unit: 'ms' },
    { label: 'Slowest', value: ms(Math.max(...rtts)), unit: 'ms' },
    { label: 'Lost', value: loss.toFixed(0), unit: '%' },
  ];
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg }}>
      {cells.map((cell) => (
        <View key={cell.label} style={{ width: '50%' }}>
          <Readout
            value={cell.value}
            unit={cell.unit}
            label={cell.label}
            tone={cell.label === 'Lost' && loss > 0 ? 'warn' : undefined}
          />
        </View>
      ))}
    </View>
  );
}
