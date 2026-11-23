import React from 'react';
import { View } from 'react-native';
import { Button, Text, space } from '@apps-hub/ui';

export interface ChipOption<K extends string | number> {
  key: K;
  label: string;
  spoken?: string;
}

// Pick any number of options: a picked one is filled.
export function Chips<K extends string | number>({ title, options, selected, onToggle }: { title: string; options: ReadonlyArray<ChipOption<K>>; selected: readonly K[]; onToggle: (key: K) => void }) {
  return (
    <View style={{ gap: space.xs + 2 }}>
      <Text variant="caption" tone="muted">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((o) => {
          const on = selected.includes(o.key);
          return <Button key={o.key} label={o.label} size="sm" variant={on ? 'primary' : 'secondary'} accessibilityLabel={`${o.spoken ?? o.label}, ${on ? 'picked' : 'not picked'}`} onPress={() => onToggle(o.key)} />;
        })}
      </View>
    </View>
  );
}
