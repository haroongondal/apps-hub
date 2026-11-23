/**
 * ScannerScreen — FR-1/FR-2/FR-4 view (Phase 4). The scan itself runs in
 * ScanProvider so it outlives this tab; this screen renders the devices and
 * owns the filter, the device sheet and its ping, port and control checks.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, FlatList, Linking, Switch, View } from 'react-native';
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
  RecordMenu,
  Row,
  Screen,
  Segmented,
  Sheet,
  Text,
  confirmAction,
  radius,
  space,
  useTheme,
  type RecordAction,
} from '@apps-hub/ui';

import {
  COMMON_PORTS,
  checkPorts,
  detectControls,
  webUrlFor,
  displayNameFor,
  networkLabel,
  parseMac,
  type DetectedControl,
  type KnownPort,
  type ReconciledDevice,
  type StoredNetwork,
} from '@apps-hub/core';

import { DeviceControls } from '../components/DeviceControls';
import { WakeDevice } from '../components/WakeDevice';
import { NewDevices } from '../components/NewDevices';
import { useNetworkScan } from '../scan/ScanProvider';

type FilterKey = 'all' | 'new' | 'untrusted';

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'untrusted', label: 'Untrusted' },
];

/** Targeted-ping plan (5 samples × 250 ms; native connect-timeout cap 10 s). */
const PING_SAMPLE_COUNT = 5;
const PING_INTERVAL_MS = 250;
const PING_TIMEOUT_MS = 800;
/** First stored open/forwarded port, falling back to the hard-rule set. */
function detailPort(device: ReconciledDevice): number {
  const first = Number(device.openPortsCsv.split(',')[0]);
  return Number.isInteger(first) && first > 0 ? first : DEFAULT_PING_PORT;
}
const DEFAULT_PING_PORT = 80;

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
  const {
    iface,
    plan,
    phase,
    discovered,
    devices,
    mdnsTypes,
    errorNote,
    locationsByIp,
    store,
    runScan,
    stopScan,
    saveDevice,
    forgetDevice: forgetStoredDevice,
    currentNetworkId,
    networkName,
    savedNetworks,
    loadNetworks,
    renameNetwork,
    forgetNetwork: forgetStoredNetwork,
    binding: bindingProxy,
  } = useNetworkScan();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [opened, setDetail] = useState<ReconciledDevice | null>(null);
  // The open sheet follows the latest row, so names that arrive while it is open show up.
  const detail = useMemo(
    () => (opened === null ? null : (devices.find((row) => row.id === opened.id) ?? opened)),
    [devices, opened],
  );
  const [nameDraft, setNameDraft] = useState('');
  const [personDraft, setPersonDraft] = useState('');
  const openedPerson = useRef('');
  const [macDraft, setMacDraft] = useState('');
  const openedMac = useRef('');
  const [trustDraft, setTrustDraft] = useState(false);
  const [pingTargetBusy, setPingTargetBusy] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  // open === null while the check runs.
  const [portCheck, setPortCheck] = useState<{ ip: string; open: KnownPort[] | null } | null>(null);
  // Tagged with the ip it was detected for, so a sheet moved to another device never shows it.
  const [controls, setControls] = useState<{ ip: string; found: DetectedControl[] } | null>(null);
  const [networksOpen, setNetworksOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ network: StoredNetwork; draft: string } | null>(null);

  const parsedMac = parseMac(macDraft);
  const macInvalid = macDraft.trim() !== '' && parsedMac === null;
  const scanning = phase === 'scanning' || phase === 'reconciling';
  const totalTargets = plan?.hosts.length ?? 254;

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
  const prevPhase = useRef(phase);
  useEffect(() => {
    // Only on the move to done, not when the tab remounts with the scan already done.
    if (phase === 'done' && prevPhase.current !== 'done') {
      AccessibilityInfo.announceForAccessibility(
        `Scan finished. ${activeCount} devices responding, ${newBadgeCount} new.`,
      );
    }
    prevPhase.current = phase;
  }, [phase, activeCount, newBadgeCount]);

  const openDetail = useCallback((device: ReconciledDevice): void => {
    setDetail(device);
    setNameDraft(device.customName ?? '');
    setPersonDraft(device.person ?? '');
    openedPerson.current = device.person ?? '';
    setMacDraft(device.mac ?? '');
    openedMac.current = device.mac ?? '';
    setTrustDraft(device.isTrusted);
    setPingResult(null);
    setPortCheck(null);
  }, []);

  const saveDetail = useCallback(async (): Promise<void> => {
    // Keep the sheet open until the store is ready, so the edit isn't dropped.
    if (store === null || detail === null) return;
    const person = personDraft.trim();
    // An invalid MAC is never saved; the sheet stays open with the hint showing.
    if (macInvalid) return;
    setDetail(null);
    await saveDevice(detail.id, {
      customName: nameDraft.trim() || null,
      // Untouched means the latest row's tag stays: a tag carried over while the sheet was open must survive.
      ...(person !== openedPerson.current.trim() && { person: person || null }),
      // Same for the MAC: a hardware address learned while the sheet was open must survive.
      ...(macDraft.trim() !== openedMac.current.trim() && { mac: parsedMac }),
      isTrusted: trustDraft,
    });
  }, [detail, macDraft, macInvalid, nameDraft, parsedMac, personDraft, saveDevice, store, trustDraft]);

  const forgetDevice = useCallback(
    (device: ReconciledDevice): Promise<void> => {
      setDetail((open) => (open !== null && open.id === device.id ? null : open));
      return forgetStoredDevice(device);
    },
    [forgetStoredDevice],
  );

  const deviceActions = (device: ReconciledDevice, name: string): RecordAction[] => [
    { label: 'Edit', onPress: () => openDetail(device) },
    {
      label: 'Forget device',
      destructive: true,
      confirmTitle: `Forget \u201c${name}\u201d?`,
      confirmMessage: 'HomeNet removes its saved name and trust. It shows up as new if it answers a scan again.',
      confirmLabel: 'Forget',
      onPress: () => void forgetDevice(device),
    },
  ];

  const confirmForgetDetail = (device: ReconciledDevice): void => {
    confirmAction({
      title: `Forget \u201c${displayNameFor(device)}\u201d?`,
      message: 'HomeNet removes its saved name and trust. It shows up as new if it answers a scan again.',
      confirmLabel: 'Forget',
      onConfirm: () => void forgetDevice(device),
    });
  };

  const openNetworks = useCallback(async (): Promise<void> => {
    if (store === null) return;
    setRenaming(null);
    setNetworksOpen(true);
    if (!(await loadNetworks())) setNetworksOpen(false);
  }, [loadNetworks, store]);

  const closeNetworks = (): void => {
    if (renaming !== null) return setRenaming(null);
    setNetworksOpen(false);
  };

  const saveNetworkName = useCallback(async (): Promise<void> => {
    if (renaming === null) return;
    setRenaming(null);
    await renameNetwork(renaming.network, renaming.draft);
  }, [renameNetwork, renaming]);

  const forgetNetwork = useCallback(
    async (network: StoredNetwork): Promise<void> => {
      const current = network.networkId === currentNetworkId;
      if ((await forgetStoredNetwork(network)) && current) setDetail(null);
    },
    [currentNetworkId, forgetStoredNetwork],
  );

  const networkActions = (network: StoredNetwork): RecordAction[] => [
    { label: 'Rename', onPress: () => setRenaming({ network, draft: network.customName ?? '' }) },
    {
      label: 'Forget network',
      destructive: true,
      confirmTitle: `Forget \u201c${networkLabel(network)}\u201d?`,
      confirmMessage: 'HomeNet removes this network and every device it saved for it. A later scan starts fresh.',
      confirmLabel: 'Forget',
      onPress: () => void forgetNetwork(network),
    },
  ];

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

  const portsBusy = portCheck !== null && portCheck.open === null;
  const runPortCheck = useCallback(async (): Promise<void> => {
    if (detail === null || portsBusy) return;
    const ip = detail.lastIp;
    setPortCheck({ ip, open: null });
    const open = await checkPorts(bindingProxy, ip);
    // Drop the result if the sheet moved on to another device meanwhile.
    setPortCheck((current) => (current?.ip === ip ? { ip, open } : current));
  }, [bindingProxy, detail, portsBusy]);

  const detailIp = detail?.lastIp ?? null;
  useEffect(() => {
    setControls(null);
    if (detailIp === null || iface === null) return;
    let stale = false;
    void detectControls(bindingProxy, iface, detailIp, locationsByIp.get(detailIp) ?? []).then((found) => {
      if (!stale) setControls({ ip: detailIp, found });
    });
    return () => {
      stale = true;
    };
  }, [bindingProxy, detailIp, iface, locationsByIp]);

  const subnet = plan ? `${plan.networkIp}/${plan.prefix}` : null;
  const networkLine = subnet && networkName ? `${networkName}, ${subnet}` : subnet;
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
          {networkLine ? (
            <Text variant="data" tone="muted">
              {networkLine}
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
          disabled={store === null}
          accessibilityHint="Looks for devices on your Wi-Fi"
        />
      )}

      <Button
        label="Saved networks"
        variant="ghost"
        block
        onPress={() => void openNetworks()}
        disabled={store === null || scanning}
        accessibilityHint="Rename or forget networks HomeNet has scanned"
      />

      <NewDevices />

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
      body="HomeNet asks every address on your network for a reply. Nothing leaves your network."
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
        ItemSeparatorComponent={GroupSeparator}
        renderItem={({ item, index }) => {
          const name = displayNameFor(item);
          const facts = [
            item.isNew ? 'new' : null,
            item.isTrusted ? 'trusted' : null,
            item.seenThisScan ? null : 'not seen in this scan',
          ].filter(Boolean);
          return (
            <GroupItem first={index === 0} last={index === visible.length - 1}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                    {item.isNew || item.isTrusted ? (
                      <View style={{ gap: space.xs, alignItems: 'flex-end' }}>
                        {item.isNew ? <Pill label="New" tone="accent" /> : null}
                        {item.isTrusted ? <Pill label="Trusted" tone="ok" /> : null}
                      </View>
                    ) : null}
                    <RecordMenu title={name} actions={deviceActions(item, name)} />
                  </View>
                }
              />
            </GroupItem>
          );
        }}
      />

      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        onDone={() => void saveDetail()}
        doneLabel="Save"
        title={detail ? displayNameFor(detail) : 'Device'}
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

            <Field
              label="Whose phone is this?"
              value={personDraft}
              onChangeText={setPersonDraft}
              placeholder="e.g. Sara"
              hint="Shows this person on the Home tab."
              returnKeyType="done"
            />

            <Field
              label="Hardware address (MAC)"
              value={macDraft}
              onChangeText={setMacDraft}
              placeholder="AA:BB:CC:DD:EE:FF"
              hint="Needed to wake this device. Found automatically for some Windows PCs."
              error={macInvalid ? 'Use six pairs like AA:BB:CC:DD:EE:FF.' : null}
              autoCapitalize="characters"
              autoCorrect={false}
              mono
              returnKeyType="done"
            />

            {parsedMac !== null ? (
              <WakeDevice
                key={detail.id}
                binding={bindingProxy}
                iface={iface}
                mac={parsedMac}
                ip={detail.lastIp}
              />
            ) : null}

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

            {controls !== null && controls.ip === detail.lastIp && iface !== null ? (
              <DeviceControls
                key={controls.ip}
                binding={bindingProxy}
                iface={iface}
                ip={controls.ip}
                controls={controls.found}
              />
            ) : null}

            <Group title="Details">
              <Fact label="IP address" value={detail.lastIp} />
              {detail.openPortsCsv ? <Fact label="Open port" value={detail.openPortsCsv} /> : null}
              {detail.hostname ? <Fact label="Hostname" value={detail.hostname} /> : null}
              {detail.mdnsName ? <Fact label="Bonjour name" value={detail.mdnsName} /> : null}
              {detail.friendlyName ? <Fact label="UPnP name" value={detail.friendlyName} /> : null}
              {detail.model ? <Fact label="Model" value={detail.model} /> : null}
              {detail.netbiosName ? <Fact label="Windows name" value={detail.netbiosName} /> : null}
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

            <View style={{ gap: space.md }}>
              <Group title="Open ports" footer={`Checks ${COMMON_PORTS.length} common services.`}>
                {portCheck === null || portCheck.open === null ? (
                  <Row
                    title={portsBusy ? 'Checking' : 'Not checked yet'}
                    subtitle={portsBusy ? 'Takes a few seconds.' : 'See which services this device offers, and open its web page.'}
                  />
                ) : portCheck.open.length === 0 ? (
                  <Row title="No common ports open" subtitle="The device may still use ports HomeNet doesn't check." />
                ) : (
                  portCheck.open.map((known) => {
                    const url = webUrlFor(portCheck.ip, known);
                    return (
                      <Row
                        key={known.port}
                        title={known.label}
                        subtitle={known.risk ? `Port ${known.port}. ${known.risk}` : `Port ${known.port}`}
                        trailing={
                          url !== null ? (
                            <Button
                              label="Open"
                              variant="secondary"
                              size="sm"
                              onPress={() => void Linking.openURL(url).catch(() => undefined)}
                              accessibilityHint={`Opens ${url} in your browser`}
                            />
                          ) : known.risk ? (
                            <Pill label="Risky" tone="warn" />
                          ) : undefined
                        }
                      />
                    );
                  })
                )}
              </Group>
              <Button
                label={portsBusy ? 'Checking' : portCheck !== null ? 'Check again' : 'Check ports'}
                variant="secondary"
                block
                busy={portsBusy}
                onPress={() => void runPortCheck()}
                accessibilityHint="Checks which common services this device offers"
              />
            </View>

            <Button
              label="Forget device"
              variant="secondary"
              tone="danger"
              block
              onPress={() => confirmForgetDetail(detail)}
              accessibilityHint="Removes this device and its saved name and trust"
            />
          </>
        ) : null}
      </Sheet>

      <Sheet
        visible={networksOpen}
        onClose={closeNetworks}
        onDone={renaming !== null ? () => void saveNetworkName() : undefined}
        doneLabel={renaming !== null ? 'Save' : 'Done'}
        title={renaming !== null ? 'Rename network' : 'Saved networks'}
      >
        {renaming !== null ? (
          <Field
            label="Name"
            value={renaming.draft}
            onChangeText={(draft) => setRenaming({ ...renaming, draft })}
            placeholder="e.g. Home"
            hint={`Shown instead of ${renaming.network.subnetCidr}. Leave it empty to use the address.`}
            returnKeyType="done"
            autoFocus
          />
        ) : savedNetworks.length === 0 ? (
          <Empty title="No saved networks" body="Networks you scan are remembered here so you can rename or forget them." />
        ) : (
          <Group footer="Forgetting a network also forgets the devices saved for it.">
            {savedNetworks.map((network) => (
              <Row
                key={network.networkId}
                title={networkLabel(network)}
                subtitle={
                  <Text variant="meta" tone="muted">
                    {`${network.subnetCidr}, last scanned ${new Date(network.lastScannedAt).toLocaleDateString()}`}
                  </Text>
                }
                trailing={<RecordMenu title={networkLabel(network)} actions={networkActions(network)} />}
              />
            ))}
          </Group>
        )}
      </Sheet>
    </Screen>
  );
}

/** One FlatList row drawn as part of a rounded group, matching the ui Group look without losing virtualisation. */
function GroupItem({ first, last, children }: { first: boolean; last: boolean; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        { ...groupEdge(c), overflow: 'hidden' },
        first && { borderTopWidth: 1, borderTopLeftRadius: radius.group, borderTopRightRadius: radius.group },
        last && { borderBottomWidth: 1, borderBottomLeftRadius: radius.group, borderBottomRightRadius: radius.group },
      ]}
    >
      {children}
    </View>
  );
}

function GroupSeparator() {
  const { c } = useTheme();
  return (
    <View style={groupEdge(c)}>
      <View style={{ height: 1, backgroundColor: c.line, marginLeft: space.lg }} />
    </View>
  );
}

function groupEdge(c: ReturnType<typeof useTheme>['c']) {
  return { borderColor: c.line, borderLeftWidth: 1, borderRightWidth: 1, marginHorizontal: space.lg, backgroundColor: c.surface };
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
