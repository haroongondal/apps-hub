/**
 * Remote controls for the device sheet: one group per kind of control found on the device.
 * Nothing here runs on its own except state reads; every change waits for a tap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Group, Notice, Readout, Row, space, useTheme } from '@apps-hub/ui';
import {
  dlnaGetMute,
  dlnaGetVolume,
  dlnaSetMute,
  dlnaSetVolume,
  dlnaTransport,
  plugGetPower,
  plugSetPower,
  rokuKey,
  wledGet,
  wledSet,
  type DetectedControl,
  type InterfaceInfo,
  type NetLensNativeBinding,
  type RokuKey,
  type SoapService,
  type WledState,
} from '@apps-hub/core';

type Binding = Pick<NetLensNativeBinding, 'tcpFetch'>;
type Target = { binding: Binding; iface: InterfaceInfo; ip: string };

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Runs one action at a time per control; a failure shows the notice and re-reads state. */
function useAction(reread: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(
    async (action: () => Promise<boolean>): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setFailed(false);
      let ok = false;
      try {
        ok = await action();
        if (!ok) await reread();
      } catch {
        ok = false;
      } finally {
        if (alive.current) {
          setFailed(!ok);
          setBusy(false);
        }
      }
    },
    [busy, reread],
  );
  return { busy, failed, run };
}

const Failed = ({ show }: { show: boolean }) =>
  show ? <Notice tone="warn">Didn't respond. Check the device is on and try again.</Notice> : null;

const Line = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', gap: space.sm }}>{children}</View>
);

function Key({ label, onPress, disabled }: { label?: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      {label && onPress ? <Button label={label} onPress={onPress} variant="secondary" size="sm" disabled={disabled} /> : null}
    </View>
  );
}

function RokuRemote({ binding, iface, ip }: Target) {
  const { busy, failed, run } = useAction(useCallback(async () => {}, []));
  const press = (key: RokuKey) => () => void run(() => rokuKey(binding, iface, ip, key));
  return (
    <Group title="Remote">
      <Row title="Navigation">
        <Line><Key /><Key label="Up" onPress={press('Up')} disabled={busy} /><Key /></Line>
        <Line>
          <Key label="Left" onPress={press('Left')} disabled={busy} />
          <Key label="OK" onPress={press('Select')} disabled={busy} />
          <Key label="Right" onPress={press('Right')} disabled={busy} />
        </Line>
        <Line><Key /><Key label="Down" onPress={press('Down')} disabled={busy} /><Key /></Line>
      </Row>
      <Row title="Buttons">
        <Line>
          <Key label="Home" onPress={press('Home')} disabled={busy} />
          <Key label="Back" onPress={press('Back')} disabled={busy} />
          <Key label="Play or pause" onPress={press('Play')} disabled={busy} />
        </Line>
        <Line>
          <Key label="Volume down" onPress={press('VolumeDown')} disabled={busy} />
          <Key label="Volume up" onPress={press('VolumeUp')} disabled={busy} />
          <Key label="Mute" onPress={press('VolumeMute')} disabled={busy} />
        </Line>
        <Line><Key label="Power off" onPress={press('PowerOff')} disabled={busy} /></Line>
        <Failed show={failed} />
      </Row>
    </Group>
  );
}

function DlnaRemote({ binding, iface, rendering, transport }: Target & { rendering: SoapService | null; transport: SoapService | null }) {
  const { c } = useTheme();
  const [volume, setVolume] = useState<number | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  const readState = useCallback(async (): Promise<void> => {
    if (!rendering) return;
    setVolume(await dlnaGetVolume(binding, iface, rendering));
    setMuted(await dlnaGetMute(binding, iface, rendering));
  }, [binding, iface, rendering]);
  useEffect(() => { void readState(); }, [readState]);
  const { busy, failed, run } = useAction(readState);
  const step = (delta: number) => () => {
    if (!rendering || volume === null) return;
    void run(async () => {
      const ok = await dlnaSetVolume(binding, iface, rendering, clamp(volume + delta, 0, 100));
      await readState();
      return ok;
    });
  };
  const play = (action: 'Play' | 'Pause' | 'Next' | 'Previous') => () =>
    void run(() => (transport ? dlnaTransport(binding, iface, transport, action) : Promise.resolve(false)));
  return (
    <Group title="Media player">
      {transport ? (
        <Row title="Playback">
          <Line>
            <Key label="Previous" onPress={play('Previous')} disabled={busy} />
            <Key label="Play" onPress={play('Play')} disabled={busy} />
            <Key label="Pause" onPress={play('Pause')} disabled={busy} />
            <Key label="Next" onPress={play('Next')} disabled={busy} />
          </Line>
        </Row>
      ) : null}
      {rendering ? (
        <Row title="Volume">
          <Readout label="Volume" value={volume === null ? '–' : String(volume)} />
          <Line>
            <Key label="Volume down" onPress={step(-5)} disabled={busy || volume === null} />
            <Key label="Volume up" onPress={step(5)} disabled={busy || volume === null} />
          </Line>
        </Row>
      ) : null}
      {rendering ? (
        <Row
          title="Mute"
          trailing={
            <Switch
              value={muted === true}
              disabled={busy || muted === null}
              onValueChange={(next) => void run(async () => {
                const ok = await dlnaSetMute(binding, iface, rendering, next);
                await readState();
                return ok;
              })}
              accessibilityLabel="Mute"
              trackColor={{ false: c.line, true: c.accent }}
              ios_backgroundColor={c.line}
            />
          }
        />
      ) : null}
      {failed ? <Row title={<Failed show />} /> : null}
    </Group>
  );
}

function PlugControl({ binding, iface, ip, control }: Target & { control: Extract<DetectedControl, { kind: 'shelly' | 'tasmota' }> }) {
  const { c } = useTheme();
  const [power, setPower] = useState<boolean | null>(null);
  const locked = control.kind === 'tasmota' && control.locked;
  const readState = useCallback(async (): Promise<void> => {
    if (!locked) setPower(await plugGetPower(binding, iface, ip, control));
  }, [binding, iface, ip, control, locked]);
  useEffect(() => { void readState(); }, [readState]);
  const { busy, failed, run } = useAction(readState);
  if (locked) {
    return (
      <Group title="Smart plug">
        <Row title="This plug has a password. HomeNet can't control it yet." />
      </Group>
    );
  }
  return (
    <Group title="Smart plug">
      <Row
        title="Power"
        trailing={
          <Switch
            value={power === true}
            disabled={busy || power === null}
            onValueChange={(next) => void run(async () => {
              const after = await plugSetPower(binding, iface, ip, control, next);
              if (after !== null) setPower(after);
              return after !== null;
            })}
            accessibilityLabel="Power"
            trackColor={{ false: c.line, true: c.accent }}
            ios_backgroundColor={c.line}
          />
        }
      />
      {failed ? <Row title={<Failed show />} /> : null}
    </Group>
  );
}

function WledControl({ binding, iface, ip }: Target) {
  const { c } = useTheme();
  const [state, setState] = useState<WledState | null>(null);
  const readState = useCallback(async (): Promise<void> => {
    setState(await wledGet(binding, iface, ip));
  }, [binding, iface, ip]);
  useEffect(() => { void readState(); }, [readState]);
  const { busy, failed, run } = useAction(readState);
  const change = (next: { on?: boolean; bri?: number }) =>
    void run(async () => {
      const after = await wledSet(binding, iface, ip, next);
      if (after !== null) setState(after);
      return after !== null;
    });
  return (
    <Group title="Lights">
      <Row
        title="Power"
        trailing={
          <Switch
            value={state?.on === true}
            disabled={busy || state === null}
            onValueChange={(on) => change({ on })}
            accessibilityLabel="Power"
            trackColor={{ false: c.line, true: c.accent }}
            ios_backgroundColor={c.line}
          />
        }
      />
      <Row title="Brightness">
        <Readout label="Brightness" value={state === null ? '–' : String(state.bri)} />
        <Line>
          <Key label="Brightness down" onPress={() => state && change({ bri: clamp(state.bri - 25, 1, 255) })} disabled={busy || state === null} />
          <Key label="Brightness up" onPress={() => state && change({ bri: clamp(state.bri + 25, 1, 255) })} disabled={busy || state === null} />
        </Line>
      </Row>
      {failed ? <Row title={<Failed show />} /> : null}
    </Group>
  );
}

/** Mount with a key of the device ip, so state never carries over to another device. */
export function DeviceControls({ binding, iface, ip, controls }: Target & { controls: DetectedControl[] }) {
  return (
    <>
      {controls.map((control) => {
        switch (control.kind) {
          case 'roku':
            return <RokuRemote key="roku" binding={binding} iface={iface} ip={ip} />;
          case 'dlna':
            return <DlnaRemote key="dlna" binding={binding} iface={iface} ip={ip} rendering={control.rendering} transport={control.transport} />;
          case 'shelly':
          case 'tasmota':
            return <PlugControl key={control.kind} binding={binding} iface={iface} ip={ip} control={control} />;
          case 'wled':
            return <WledControl key="wled" binding={binding} iface={iface} ip={ip} />;
        }
      })}
    </>
  );
}
