/**
 * HomeScreen: who is home, from the shared scan. "Check now" runs a scan, then
 * re-probes the tagged phones that did not answer it, since a sleeping phone can
 * miss one sweep. A re-probe hit only affects this view; it is never stored.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Group, Header, Notice, Pill, Row, Screen, Text, space } from '@apps-hub/ui';

import { peopleStatus, probeHome, type PersonStatus, type ReconciledDevice } from '@apps-hub/core';

import { useNetworkScan } from '../scan/ScanProvider';

/** Sockets stay bounded: at most this many people are probed at once. */
const PROBE_CONCURRENCY = 4;

export function lastSeenText(lastSeenAt: number, now: number): string {
  if (!lastSeenAt) return 'Not seen yet';
  const minutes = Math.max(0, Math.floor((now - lastSeenAt) / 60_000));
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  return `Last seen ${Math.floor(hours / 24)} d ago`;
}

export default function HomeScreen() {
  const { phase, devices, errorNote, store, runScan, binding } = useNetworkScan();
  const [override, setOverride] = useState<ReadonlySet<string>>(new Set());
  const [probing, setProbing] = useState(false);
  // True from the press until the scan it started reaches done or error.
  const awaitingScan = useRef(false);
  // Bumped on every scan start, new check and unmount; a probe holding an older value drops its result.
  const token = useRef(0);
  // The probe runs from an effect, so it reads the devices committed in the same render as phase 'done'.
  const devicesRef = useRef<ReconciledDevice[]>(devices);
  devicesRef.current = devices;

  const scanning = phase === 'scanning' || phase === 'reconciling';

  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );

  const probeMissing = useCallback(
    async (mine: number): Promise<void> => {
      const byId = new Map(devicesRef.current.map((d) => [d.id, d]));
      const missing = peopleStatus(devicesRef.current).filter((p) => !p.home);
      const found: string[] = [];
      let next = 0;
      const worker = async (): Promise<void> => {
        while (token.current === mine && next < missing.length) {
          const person: PersonStatus = missing[next++];
          for (const id of person.deviceIds) {
            const device = byId.get(id);
            if (!device || token.current !== mine) continue;
            if (await probeHome(binding, device.lastIp)) {
              found.push(person.person);
              break;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, missing.length) }, worker));
      if (token.current !== mine) return;
      setOverride(new Set(found));
      setProbing(false);
    },
    [binding],
  );

  useEffect(() => {
    if (scanning) {
      // A scan from any tab supersedes an earlier re-probe and its override.
      token.current += 1;
      setOverride(new Set());
      setProbing(false);
      return;
    }
    if (!awaitingScan.current) return;
    if (phase === 'done') {
      awaitingScan.current = false;
      setProbing(true);
      void probeMissing(token.current);
    } else if (phase === 'error') {
      awaitingScan.current = false;
    }
  }, [phase, probeMissing, scanning]);

  const checkNow = useCallback((): void => {
    awaitingScan.current = true;
    void runScan();
  }, [runScan]);

  const now = Date.now();
  const people = useMemo(() => peopleStatus(devices), [devices]);
  const homeCount = people.filter((p) => p.home || override.has(p.person)).length;
  const busy = scanning || probing;

  return (
    <Screen scroll>
      <Header title="Who's home" subtitle="Updates while HomeNet is open." />

      {errorNote !== null ? (
        <Notice tone="danger" title={phase === 'error' ? "The check didn't finish" : 'HomeNet hit a problem'}>
          {phase === 'error' ? `${errorNote} Check that Wi-Fi is on and connected, then try again.` : errorNote}
        </Notice>
      ) : null}

      <Button
        label={scanning ? 'Scanning…' : probing ? 'Checking…' : 'Check now'}
        block
        busy={busy}
        disabled={busy || store === null}
        onPress={checkNow}
        accessibilityHint="Scans your Wi-Fi and looks for the people you have tagged"
      />

      {people.length === 0 ? (
        <View style={{ gap: space.md }}>
          <Notice>
            {"Tag a phone to see who's home. Open a device on the Devices tab and fill in Whose phone is this?. Tip: reserve that phone's IP address in your router so HomeNet always recognises it."}
          </Notice>
          {devices.length === 0 ? (
            <Text variant="meta" tone="muted">
              Run a check to see who's home.
            </Text>
          ) : null}
        </View>
      ) : (
        <Group footer={`${homeCount} of ${people.length} home`}>
          {people.map((p) => {
            const home = p.home || override.has(p.person);
            return (
              <Row
                key={p.person}
                title={p.person}
                subtitle={home ? undefined : lastSeenText(p.lastSeenAt, now)}
                trailing={home ? <Pill label="Home" tone="ok" /> : undefined}
                accessibilityLabel={`${p.person}, ${home ? 'home' : lastSeenText(p.lastSeenAt, now)}`}
              />
            );
          })}
        </Group>
      )}
    </Screen>
  );
}
