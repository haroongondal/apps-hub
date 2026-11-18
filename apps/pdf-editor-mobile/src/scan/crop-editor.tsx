import { useTheme } from '@apps-hub/ui';
import { Image } from 'expo-image';
import type { Quad } from 'pdf-scan';
import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { moveCorner } from './quad-math';

const HANDLE = 44;
const NUDGE = 0.01;
const NAMES = ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'] as const;
const ACTIONS = [
  { name: 'left', label: 'Move left' },
  { name: 'right', label: 'Move right' },
  { name: 'up', label: 'Move up' },
  { name: 'down', label: 'Move down' },
];

export interface CropEditorProps {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  quad: Quad;
  onChange(q: Quad): void;
}

interface HandleProps {
  index: 0 | 1 | 2 | 3;
  quadRef: { current: Quad };
  size: { w: number; h: number };
  onChange(q: Quad): void;
}

function Handle({ index, quadRef, size, onChange }: HandleProps) {
  const { c } = useTheme();
  const start = useRef<[number, number]>([0, 0]);
  const quad = quadRef.current;
  const move = (x: number, y: number) => onChange(moveCorner(quadRef.current, index, x, y));
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin(() => {
          start.current = [quadRef.current[index * 2], quadRef.current[index * 2 + 1]];
        })
        .onUpdate((e) => move(start.current[0] + e.translationX / size.w, start.current[1] + e.translationY / size.h)),
    // move only reads refs and the stable onChange prop
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, size.w, size.h, onChange],
  );
  const x = quad[index * 2];
  const y = quad[index * 2 + 1];
  const nudge = (name: string) => {
    if (name === 'left') move(x - NUDGE, y);
    else if (name === 'right') move(x + NUDGE, y);
    else if (name === 'up') move(x, y - NUDGE);
    else if (name === 'down') move(x, y + NUDGE);
  };
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={NAMES[index]}
        accessibilityHint="Drag to move, or use the actions to nudge by 1 percent"
        accessibilityActions={ACTIONS}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName)}
        style={{ position: 'absolute', left: x * size.w - HANDLE / 2, top: y * size.h - HANDLE / 2, width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.accent, borderWidth: 3, borderColor: c.onAccent }} />
      </View>
    </GestureDetector>
  );
}

export function CropEditor({ uri, imageWidth, imageHeight, quad, onChange }: CropEditorProps) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const quadRef = useRef(quad);
  quadRef.current = quad;
  const size = { w: width, h: width * (imageHeight / Math.max(1, imageWidth)) };
  const edges = [0, 1, 2, 3].map((i) => {
    const j = (i + 1) % 4;
    const ax = quad[i * 2] * size.w;
    const ay = quad[i * 2 + 1] * size.h;
    const bx = quad[j * 2] * size.w;
    const by = quad[j * 2 + 1] * size.h;
    const len = Math.hypot(bx - ax, by - ay);
    return { i, len, cx: (ax + bx) / 2, cy: (ay + by) / 2, angle: Math.atan2(by - ay, bx - ax) };
  });
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', height: size.h }}>
      {width > 0 ? (
        <>
          <Image source={{ uri }} style={{ width: size.w, height: size.h }} contentFit="fill" accessibilityLabel="Page photo" />
          {edges.map((e) => (
            <View
              key={e.i}
              pointerEvents="none"
              style={{ position: 'absolute', left: e.cx - e.len / 2, top: e.cy - 1, width: e.len, height: 2, backgroundColor: c.accent, transform: [{ rotate: `${e.angle}rad` }] }}
            />
          ))}
          {([0, 1, 2, 3] as const).map((i) => (
            <Handle key={i} index={i} quadRef={quadRef} size={size} onChange={onChange} />
          ))}
        </>
      ) : null}
    </View>
  );
}
