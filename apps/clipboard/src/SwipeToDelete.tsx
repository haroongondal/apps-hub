import React, { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Text, space, useTheme } from '@apps-hub/ui';
import { isSwipe, swipeDirection } from './swipe';

interface Props {
  label: string;
  onPress: () => void;
  onDelete: () => void;
  /** More screen reader actions, such as pin and the clip's smart actions. */
  actions?: Array<{ name: string; label: string; run: () => void }>;
  children: ReactNode;
}

export function SwipeToDelete({ label, onPress, onDelete, actions = [], children }: Props) {
  const { c } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(1);
  const latest = useRef(onDelete);
  latest.current = onDelete;

  const pan = useMemo(() => {
    const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => isSwipe(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const dir = swipeDirection(g.dx, g.vx, width.current);
        if (dir === 0) return back();
        Animated.timing(x, { toValue: dir * width.current, duration: 150, useNativeDriver: false }).start(() => latest.current());
      },
      onPanResponderTerminate: back,
    });
  }, [x]);

  // A swipe can't be done with a screen reader, so delete is also an accessibility action.
  return (
    <View
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Copies this clip back. Swipe sideways to delete it."
      accessibilityActions={[{ name: 'activate' }, { name: 'delete', label: 'Delete' }, ...actions.map(({ name, label }) => ({ name, label }))]}
      onAccessibilityAction={(e) => {
        const name = e.nativeEvent.actionName;
        if (name === 'delete') return onDelete();
        const extra = actions.find((a) => a.name === name);
        return extra ? extra.run() : onPress();
      }}
    >
      <View style={[StyleSheet.absoluteFill, styles.under, { backgroundColor: c.dangerSoft }]}>
        <Text variant="bodyStrong" tone="danger">Delete</Text>
        <Text variant="bodyStrong" tone="danger">Delete</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: c.surface }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  under: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
});
