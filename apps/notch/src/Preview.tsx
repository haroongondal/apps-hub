import React from 'react';
import { Text, View } from 'react-native';
import { Group } from '@apps-hub/ui';
import { SWATCHES, clockLabel, pillHex, resolveClock, type NotchSettings } from './settings';

const SCALE = { compact: 0.85, regular: 1, large: 1.15 } as const;
const RADIUS = { pill: 999, rounded: 28, squared: 6 } as const;

// The pill is always dark, whatever the app theme, so its text is fixed white.
export function Preview({ value }: { value: NotchSettings }) {
  const width = 220 * SCALE[value.size];
  const radius = RADIUS[value.corners];
  const background = pillHex(value.pill, value.accent);
  const now = new Date();
  const time = clockLabel(now.getHours(), now.getMinutes(), resolveClock(value.clock));

  return (
    <Group title="Preview" footer="The battery number is a sample.">
      <View accessibilityRole="image" accessibilityLabel="Preview of the pill" style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <View style={{ width, height: 40, borderRadius: radius, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: SWATCHES[value.accent] }} />
        </View>
        <View style={{ width, borderRadius: radius, backgroundColor: background, padding: 16, gap: 6, minHeight: 96 }}>
          {value.widgets.includes('clock') && <Text style={{ color: '#FFFFFF', fontSize: 26 }}>{time}</Text>}
          {value.widgets.includes('battery') && <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>Battery 82%</Text>}
        </View>
      </View>
    </Group>
  );
}
