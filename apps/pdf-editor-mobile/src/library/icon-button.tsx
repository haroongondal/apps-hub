import { radius, useTheme } from '@apps-hub/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { width: 44, height: 44, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
        pressed && { backgroundColor: c.raised },
      ]}
    >
      <Ionicons name={icon} size={24} color={c.text} />
    </Pressable>
  );
}
