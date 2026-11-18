import React from 'react';
import { View } from 'react-native';
import { useTheme } from '@apps-hub/ui';

const BAR = 8;

export function Bar({ fraction }: { fraction: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height: BAR, borderRadius: BAR / 2, backgroundColor: c.accentSoft, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(fraction * 100)}%`, height: BAR, backgroundColor: c.accent }} />
    </View>
  );
}
