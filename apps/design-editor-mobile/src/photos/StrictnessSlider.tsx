import { Text, radius, space, touch, useTheme } from '@apps-hub/ui';
import { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

import { blurAt, blurFraction } from './cleanup';

type Blur = { min: number; max: number };
const THUMB = 24;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// P5: linear between blur.min and blur.max; a higher threshold shows more photos. onChange fires on release
// and on each accessibility step (1/10 of the range), never while dragging, so groups reload once per move.
export function StrictnessSlider({ value, blur, onChange }: { value: number; blur: Blur; onChange: (threshold: number) => void }) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const fraction = drag ?? blurFraction(value, blur);

  const live = useRef({ width, blur, onChange });
  live.current = { width, blur, onChange };
  const pan = useRef((() => {
    let from = 0;
    const at = (dx: number) => clamp01(from + dx / Math.max(1, live.current.width));
    const done = (f: number | null) => {
      setDrag(null);
      if (f !== null) live.current.onChange(blurAt(f, live.current.blur));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => { from = clamp01(e.nativeEvent.locationX / Math.max(1, live.current.width)); setDrag(from); },
      onPanResponderMove: (_, g) => setDrag(at(g.dx)),
      onPanResponderRelease: (_, g) => done(at(g.dx)),
      onPanResponderTerminate: () => done(null),
    });
  })()).current;

  const step = (by: number) => onChange(blurAt(fraction + by, blur));
  const x = fraction * width;

  return (
    <View style={{ gap: space.xs }}>
      <Text variant="bodyStrong">How blurry</Text>
      <View
        {...pan.panHandlers}
        onLayout={e => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="How blurry"
        accessibilityValue={{
          text: fraction <= 0 ? 'Very blurry only' : fraction >= 1 ? 'A little blurry too' : `${Math.round(fraction * 100)} percent toward a little blurry too`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)}
        style={{ height: touch, justifyContent: 'center' }}
      >
        <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: c.raised }}>
          <View style={{ width: x, height: 4, borderRadius: 2, backgroundColor: c.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', left: x - THUMB / 2, width: THUMB, height: THUMB, borderRadius: radius.pill,
            backgroundColor: c.accent, borderWidth: 2, borderColor: c.bg,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">Very blurry only</Text>
        <Text variant="caption" tone="muted">A little blurry too</Text>
      </View>
    </View>
  );
}
