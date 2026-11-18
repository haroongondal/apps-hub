import React from 'react';
import { Text, View } from 'react-native';
import { Group } from '@apps-hub/ui';
import { SWATCHES, clockLabel, earPlan, pillHex, resolveClock, type NotchSettings } from './settings';

const SCALE = { compact: 0.85, regular: 1, large: 1.15 } as const;
const RADIUS = { pill: 999, rounded: 28, squared: 6 } as const;

// The pill is always dark, whatever the app theme, so its text is fixed white.
export function Preview({ value }: { value: NotchSettings }) {
  const width = 268 * SCALE[value.size];
  const radius = RADIUS[value.corners];
  const background = pillHex(value.pill, value.accent);
  const now = new Date();
  const time = clockLabel(now.getHours(), now.getMinutes(), resolveClock(value.clock));
  const ears = earPlan(value.widgets);

  return (
    <Group title="Preview" footer="The battery number is a sample.">
      <View accessibilityRole="image" accessibilityLabel="Preview of the pill" style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
        <View style={{ width: 96, height: 28, borderRadius: radius, backgroundColor: background, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: SWATCHES[value.accent] }} />
        </View>
        <View style={{ width, borderRadius: radius, backgroundColor: background, paddingBottom: 10, minHeight: 74 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', height: 44 }}>
            <View style={{ flex: 1, paddingLeft: 16 }}>
              {ears.time && <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{time}</Text>}
            </View>
            <View style={{ width: 58 }} />
            <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 16 }}>
              {ears.battery && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: SWATCHES[value.accent] }} />
                  <Text style={{ color: '#FFFFFF', fontSize: 13 }}>82%</Text>
                </View>
              )}
            </View>
          </View>
          {ears.dateLine && (
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, textAlign: 'center' }}>Thu 19 Nov</Text>
          )}
        </View>
      </View>
    </Group>
  );
}
