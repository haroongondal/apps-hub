/**
 * RouterScreen — what the router says about the internet connection, over
 * UPnP: public IP, status, uptime, live speed, and the ports it has opened
 * for devices. Every router call goes through the core IGD client; nothing
 * here talks to the network directly. States: finding, no-wifi, no-upnp, ready.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import {
  Button,
  Empty,
  Group,
  Header,
  Notice,
  Progress,
  Readout,
  Row,
  Screen,
  Sheet,
  Text,
  space,
} from '@apps-hub/ui';

import {
  computeSubnetForHost,
  deletePortMapping,
  discoverIgd,
  displayNameFor,
  getRouterFacts,
  hashNetworkId,
  listPortMappings,
  rateBps,
  readByteCounters,
  type ByteCounters,
  type IgdServices,
  type InterfaceInfo,
  type PortMapping,
  type RouterFacts,
  type ServiceEvent,
} from '@apps-hub/core';
import { createNetLensNativeBinding } from 'netlens-core';

import { openDeviceStore } from '../db/device-store-sqlite';

const DISCOVERY_MS = 3000;
// Native discovery ends by itself; this only guarantees the screen never waits on a stuck bridge.
const DISCOVERY_GUARD_MS = 6000;
const METER_INTERVAL_MS = 2000;

type Phase = 'finding' | 'no-wifi' | 'no-upnp' | 'ready';

interface Ready {
  iface: InterfaceInfo;
  igd: IgdServices;
  facts: RouterFacts;
}

function mbit(bps: number): string {
  const value = bps / 1_000_000;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function uptimeText(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function lineSpeedText(facts: RouterFacts): string | null {
  const parts = [
    facts.maxDownBps !== null ? `${mbit(facts.maxDownBps)} Mbit/s down` : null,
    facts.maxUpBps !== null ? `${mbit(facts.maxUpBps)} Mbit/s up` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}

function openRouterSettings(gatewayIp: string): void {
  void Linking.openURL(`http://${gatewayIp}/`).catch(() => undefined);
}

function SettingsButton({ gatewayIp }: { gatewayIp: string }) {
  return (
    <Button
      label="Settings"
      variant="secondary"
      size="sm"
      onPress={() => openRouterSettings(gatewayIp)}
      accessibilityHint="Opens your router's settings page in your browser"
    />
  );
}

export default function RouterScreen() {
  const bindingProxy = useRef(createNetLensNativeBinding()).current;
  // Bumped on every load and on unmount; results from an older run see a mismatch and do nothing.
  const generation = useRef(0);
  const networkId = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>('finding');
  const [router, setRouter] = useState<Ready | null>(null);
  const [gatewayIp, setGatewayIp] = useState<string | null>(null);
  const [doors, setDoors] = useState<PortMapping[] | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  // null until the meter has passed its first two reads; "-" values until the first rate.
  const [meter, setMeter] = useState<{ down: number | null; up: number | null } | null>(null);
  const [confirm, setConfirm] = useState<PortMapping | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);

  const loadDoors = useCallback(
    async (iface: InterfaceInfo, igd: IgdServices, gen: number): Promise<void> => {
      let list: PortMapping[] = [];
      try {
        list = await listPortMappings(bindingProxy, iface, igd);
      } catch {
        // The router refused the list: show it as empty rather than spin or crash.
      }
      if (generation.current === gen) setDoors(list);
    },
    [bindingProxy],
  );

  const load = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const gen = generation.current;
    setPhase('finding');
    setRouter(null);
    setDoors(null);
    setMeter(null);
    try {
      const iface = await bindingProxy.detectInterface();
      if (generation.current !== gen) return;
      if (!iface) {
        setGatewayIp(null);
        setPhase('no-wifi');
        return;
      }
      setGatewayIp(iface.gatewayIp);

      const events: ServiceEvent[] = [];
      const handle = bindingProxy.addListener('onServiceDiscovered', (event: ServiceEvent): void => {
        events.push(event);
      });
      try {
        await Promise.race([
          bindingProxy.startServiceDiscovery(DISCOVERY_MS),
          new Promise<void>((resolve) => setTimeout(resolve, DISCOVERY_GUARD_MS)),
        ]);
      } catch {
        // Discovery failed: the router may still be found from whatever arrived.
      } finally {
        handle.remove();
      }
      if (generation.current !== gen) return;

      const igd = await discoverIgd(bindingProxy, iface, events);
      if (generation.current !== gen) return;
      if (!igd) {
        setPhase('no-upnp');
        return;
      }
      const facts = await getRouterFacts(bindingProxy, iface, igd);
      if (generation.current !== gen) return;
      setRouter({ iface, igd, facts });
      setPhase('ready');

      // Names for the doors list come from the saved scan; the IP is the fallback.
      try {
        const planned = computeSubnetForHost(iface.localIp, iface.cidrPrefix);
        networkId.current = hashNetworkId(iface.gatewayIp ?? iface.localIp, planned.prefix);
        const store = await openDeviceStore();
        const known = await store.listDevices(networkId.current);
        if (generation.current === gen) {
          setNames(new Map(known.map((device) => [device.lastIp, displayNameFor(device)])));
        }
      } catch {
        // No saved names: rows show the device address instead.
      }
      await loadDoors(iface, igd, gen);
    } catch {
      if (generation.current === gen) setPhase('no-upnp');
    }
  }, [bindingProxy, loadDoors]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // The meter runs only while the router is ready and this tab is mounted.
  useEffect(() => {
    if (router === null) return;
    const { iface, igd } = router;
    const gen = generation.current;
    let stopped = false;
    let busy = false;
    let reads = 0;
    let prev: ByteCounters | null = null;
    let firstWasEmpty = false;
    const isEmpty = (c: ByteCounters | null): boolean => c === null || (c.rx === 0 && c.tx === 0);

    const tick = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const next = await readByteCounters(bindingProxy, iface, igd, Date.now()).catch(() => null);
        if (stopped || generation.current !== gen) return;
        reads += 1;
        if (reads === 1) {
          firstWasEmpty = isEmpty(next);
        } else if (reads === 2) {
          // R4: a router that gives nothing, or all zeros, twice doesn't implement the counters.
          if (firstWasEmpty && isEmpty(next)) {
            stopped = true;
            clearInterval(timer);
            return;
          }
          setMeter({ down: null, up: null });
        }
        const rate = prev !== null && next !== null ? rateBps(prev, next) : null;
        // A wrap or reboot gives no rate: keep the last value on screen.
        if (rate !== null) setMeter({ down: rate.downBps, up: rate.upBps });
        if (next !== null) prev = next;
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), METER_INTERVAL_MS);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bindingProxy, router]);

  const nameFor = (ip: string): string => names.get(ip) ?? ip;

  const closeDoor = useCallback(async (): Promise<void> => {
    if (router === null || confirm === null || closing) return;
    const gen = generation.current;
    setClosing(true);
    setCloseFailed(false);
    let ok = false;
    try {
      ok = await deletePortMapping(bindingProxy, router.iface, router.igd, confirm);
    } catch {
      ok = false;
    }
    if (generation.current !== gen) return;
    setClosing(false);
    if (!ok) {
      setCloseFailed(true);
      return;
    }
    setConfirm(null);
    await loadDoors(router.iface, router.igd, gen);
  }, [bindingProxy, closing, confirm, loadDoors, router]);

  const dismissConfirm = (): void => {
    if (closing) return;
    setConfirm(null);
    setCloseFailed(false);
  };

  const retry = <Button label="Try again" variant="secondary" size="sm" onPress={() => void load()} />;

  return (
    <Screen scroll>
      <Header title="Router" subtitle="What your router says about your internet connection." />

      {phase === 'finding' ? (
        <View style={{ gap: space.sm }}>
          <Progress value={null} />
          <Text variant="meta" tone="muted" accessibilityLiveRegion="polite">
            Looking for your router…
          </Text>
        </View>
      ) : null}

      {phase === 'no-wifi' ? (
        <Notice tone="warn" title="This phone isn't on Wi-Fi" action={retry}>
          Connect to your home Wi-Fi network, then try again.
        </Notice>
      ) : null}

      {phase === 'no-upnp' ? (
        <Notice
          tone="warn"
          title="Your router doesn't share its status"
          action={
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {retry}
              {gatewayIp !== null ? <SettingsButton gatewayIp={gatewayIp} /> : null}
            </View>
          }
        >
          Turn on UPnP in its settings to see it here.
        </Notice>
      ) : null}

      {phase === 'ready' && router !== null ? (
        <>
          <Group title="Internet">
            <Row
              title="Public IP"
              trailing={
                <Text variant="data" selectable>
                  {router.facts.externalIp ?? 'Unknown'}
                </Text>
              }
            />
            <Row
              title="Status"
              trailing={
                <Text variant="body">
                  {router.facts.connected === null ? 'Unknown' : router.facts.connected ? 'Connected' : 'Not connected'}
                </Text>
              }
            />
            {router.facts.uptimeSec !== null ? (
              <Row title="Up for" trailing={<Text variant="body">{uptimeText(router.facts.uptimeSec)}</Text>} />
            ) : null}
            {lineSpeedText(router.facts) !== null ? (
              <Row title="Line speed" trailing={<Text variant="body">{lineSpeedText(router.facts)}</Text>} />
            ) : null}
            {router.iface.gatewayIp !== null ? (
              <Row title="Router settings" trailing={<SettingsButton gatewayIp={router.iface.gatewayIp} />} />
            ) : null}
          </Group>

          {meter !== null ? (
            <Group title="Using now">
              <Row
                title={
                  <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>
                    <Readout value={meter.down === null ? '–' : mbit(meter.down)} unit="Mbit/s" label="Download" />
                    <Readout value={meter.up === null ? '–' : mbit(meter.up)} unit="Mbit/s" label="Upload" />
                  </View>
                }
              />
            </Group>
          ) : null}

          <Group title="Open doors to the internet" footer="Devices asked your router to let the internet reach them.">
            {doors === null ? (
              <Row title="Checking" subtitle="Asking your router for its list." />
            ) : doors.length === 0 ? (
              <Row
                title="No open doors"
                subtitle="Nothing on your network asked the router to accept connections from the internet."
              />
            ) : (
              doors.map((door) => (
                <Row
                  key={`${door.protocol}-${door.externalPort}-${door.remoteHost}`}
                  title={
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {door.description || 'Unnamed'}
                    </Text>
                  }
                  subtitle={
                    <Text variant="meta" tone="muted" numberOfLines={2}>
                      {`${door.protocol} ${door.externalPort} → ${nameFor(door.internalClient)}:${door.internalPort}`}
                    </Text>
                  }
                  trailing={
                    <Button
                      label="Close"
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        setCloseFailed(false);
                        setConfirm(door);
                      }}
                      accessibilityHint="Asks you to confirm before closing this door"
                    />
                  }
                />
              ))
            )}
          </Group>
        </>
      ) : null}

      <Sheet visible={confirm !== null} onClose={dismissConfirm} title="Close this door?">
        {confirm !== null ? (
          <>
            <Text variant="body">
              {`${confirm.description || 'Unnamed'} lets the internet reach ${nameFor(confirm.internalClient)} on ${confirm.protocol} port ${confirm.externalPort}. Anything that relies on it, such as a game server, stops working from outside your network. The device can ask for it again.`}
            </Text>
            {closeFailed ? (
              <Notice tone="danger" title="The door didn't close">
                Your router didn't accept the request. Try again, or close it in the router's settings.
              </Notice>
            ) : null}
            <View style={{ gap: space.md }}>
              <Button
                label={closing ? 'Closing' : 'Close it'}
                variant="danger"
                block
                busy={closing}
                onPress={() => void closeDoor()}
              />
              <Button label="Keep it open" variant="secondary" block disabled={closing} onPress={dismissConfirm} />
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
