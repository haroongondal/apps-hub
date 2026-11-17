/**
 * Docked connection shield: the single tap surface for starting,
 * cancelling, and stopping the tunnel, pinned below the home tab's scroll
 * content (App.tsx renders it between the screen and the tab bar, and
 * under it on iOS, where no tab bar follows). State→tone and state→copy
 * live in the pure `shield-state.ts`; the tap mapping in `shield-tap.ts`.
 * Nothing native is duplicated here: every state shown arrives through the
 * `createTunnelClient` snapshot.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Dot, Text, space, toneColors, useTheme } from '@apps-hub/ui';

import type { VpnNode } from 'open-tunnel-core';
import type { TunnelSnapshot } from '../tunnel/tunnel-client.ts';
import { shieldBusy, shieldCopy, shieldTone } from './shield-state.ts';
import { shieldTap } from './shield-tap.ts';

export interface TunnelShieldProps {
  tunnel: TunnelSnapshot;
  /** Node the app last asked the client to start (label source). */
  activeNode: VpnNode | null;
  scanning: boolean;
  onConnect(node: VpnNode): void;
  onAutoSelect(): void;
  onDisconnect(): void;
}

export function TunnelShield({ tunnel, activeNode, scanning, onConnect, onAutoSelect, onDisconnect }: TunnelShieldProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const tone = shieldTone(tunnel.state);
  const busy = shieldBusy(tunnel.state);
  const color = tone === 'neutral' ? c.faint : toneColors(c, tone).fg;
  const { title, subtitle, action } = shieldCopy(tunnel, activeNode, scanning);

  // Busy states pulse instead of sitting static: a settling connection and
  // a shutdown must read as transient, never as a stable on or off. The
  // loop stops as soon as the state settles and resets to full opacity, so
  // a mid-pulse value can never stick, and unmount stops it too.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!busy) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, pulse]);

  const press = () => {
    switch (shieldTap(tunnel.state)) {
      case 'connect':
        // The explicit start out of a terminal state — same path as the
        // sheet rows; the client owns the transition into `connecting`.
        if (activeNode) onConnect(activeNode);
        else onAutoSelect();
        return;
      case 'retry':
        // Retrying a relay that just failed usually fails again: VPN Gate relays drop out often.
        onAutoSelect();
        return;
      case 'stop':
        onDisconnect();
        return;
      case 'none':
        return;
    }
  };

  return (
    <View
      style={{
        alignItems: 'center',
        borderTopWidth: 1,
        borderColor: c.line,
        backgroundColor: c.bg,
        paddingHorizontal: space.lg,
        paddingTop: space.md,
        // No tab bar sits under this dock on iOS, so the home indicator's
        // inset must be honored here as well as the dock's own padding.
        paddingBottom: insets.bottom + space.md,
      }}
    >
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={`Connection: ${title}. ${action}`}
        accessibilityState={{ busy: busy || scanning }}
        accessibilityHint={action}
        android_ripple={{ color: c.raised }}
        style={({ pressed }) => ({
          alignItems: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 16,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Animated.View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            borderWidth: 3,
            borderColor: color,
            backgroundColor: tone === 'neutral' ? c.raised : toneColors(c, tone).bg,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pulse,
          }}
        >
          {busy ? (
            <ActivityIndicator color={toneColors(c, 'warn').fg} />
          ) : (
            <Dot tone={tone} size={36} />
          )}
        </Animated.View>
        <Text variant="heading" align="center">
          {title}
        </Text>
        <Text variant="meta" tone="muted" align="center">
          {subtitle}
        </Text>
      </Pressable>
    </View>
  );
}
