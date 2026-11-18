/**
 * "Wake this device" for the device sheet. Nothing is sent until the button is pressed; the run
 * is aborted when the sheet closes, the device or its MAC changes, or the tab goes away.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { Button, Group, Row, space } from '@apps-hub/ui';
import { wakeAndWatch, type InterfaceInfo, type NetLensNativeBinding, type WakeResult } from '@apps-hub/core';

type Status = 'idle' | 'waking' | Exclude<WakeResult, 'cancelled'>;

const TEXT: Record<Exclude<Status, 'idle'>, string> = {
  waking: 'Waking…',
  awake: "It's awake.",
  'no-answer': "No answer yet. Check Wake-on-LAN is on in the PC's settings.",
  failed: 'Could not send the wake signal. Check that you are on Wi-Fi.',
};

interface Props {
  binding: Pick<NetLensNativeBinding, 'sendUdpBroadcast' | 'measureTcpHandshake'>;
  iface: InterfaceInfo | null;
  mac: string;
  ip: string;
}

export function WakeDevice({ binding, iface, mac, ip }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const run = useRef<AbortController | null>(null);

  // Cleanup runs on unmount and when the device or MAC changes: abort, so nothing more is sent.
  useEffect(() => {
    setStatus('idle');
    return () => {
      run.current?.abort();
      run.current = null;
    };
  }, [mac, ip]);

  const wake = useCallback(async (): Promise<void> => {
    if (run.current !== null) return;
    const ctrl = new AbortController();
    run.current = ctrl;
    setStatus('waking');
    const result = await wakeAndWatch({ binding, iface, mac, targetIp: ip, signal: ctrl.signal });
    if (result === 'cancelled' || ctrl.signal.aborted) return;
    run.current = null;
    setStatus(result);
    AccessibilityInfo.announceForAccessibility(TEXT[result]);
  }, [binding, iface, ip, mac]);

  return (
    <View style={{ gap: space.md }}>
      <View accessibilityLiveRegion="polite">
        <Group title="Wake" footer="Works when the PC has Wake-on-LAN turned on.">
          <Row title={status === 'idle' ? 'Not woken yet' : TEXT[status]} />
        </Group>
      </View>
      <Button
        label="Wake this device"
        variant="secondary"
        block
        busy={status === 'waking'}
        disabled={status === 'waking'}
        onPress={() => void wake()}
        accessibilityHint="Sends a wake signal, then watches for the device to answer"
      />
    </View>
  );
}
