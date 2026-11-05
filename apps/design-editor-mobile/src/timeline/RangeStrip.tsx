import { barsFor, clampZoom, formatClock, lastFrameS, moveEdge, rulerStepS, snapTenth, zoomLimits, type Range } from '@apps-hub/media-core';
import { Button, Text, alpha, radius, space, useTheme } from '@apps-hub/ui';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image, PanResponder, ScrollView, View,
  type GestureResponderEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';

import { timeText } from '../media/tools';
import { useStripMedia } from './useStripMedia';

const HEAD_H = 26, RULER_H = 18, FILM_H = 56, WAVE_H = 36, HANDLE_W = 32, GRIP_W = 14, EIGHT_SECONDS = 8;

export interface RangeStripProps {
  uri: string;
  durationS: number;
  hasVideo: boolean;
  hasSound: boolean;
  mode: 'range' | 'point';
  range: Range;
  onRange: (r: Range) => void;
  onPlayhead: (s: number) => void;
  seekS?: number; // a time typed elsewhere: the strip scrolls to it when it is not already there
}

const Bars = memo(function Bars({ bars, color }: { bars: number[]; color: string }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      {bars.map((v, i) => (
        <View key={i} style={{ flex: 1, marginHorizontal: 0.5, height: Math.max(2, Math.sqrt(v) * WAVE_H), borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
});

const Ruler = memo(function Ruler({ durationS, px, pad }: { durationS: number; px: number; pad: number }) {
  const step = rulerStepS(px, 56, durationS);
  const count = Math.floor((Number.isFinite(durationS) ? durationS : 0) / step) + 1;
  return (
    <>
      {Array.from({ length: count }, (_, i) => i * step).map(s => (
        <Text key={s} variant="caption" tone="muted" style={{ position: 'absolute', top: HEAD_H, left: pad + s * px + 3 }}>
          {step < 1 ? timeText(s) : formatClock(s)}
        </Text>
      ))}
    </>
  );
});

const Film = memo(function Film({ tiles, trackW, pad }: { tiles: string[]; trackW: number; pad: number }) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'absolute', top: HEAD_H + RULER_H, left: pad, width: trackW, height: FILM_H, flexDirection: 'row', backgroundColor: c.raised, borderRadius: 6, overflow: 'hidden' }}>
      {tiles.map((t, i) => (
        <Image key={`${i}-${t}`} source={{ uri: t }} resizeMode="cover" style={{ width: trackW / tiles.length, height: FILM_H }} />
      ))}
    </View>
  );
});

export function RangeStrip({ uri, durationS, hasVideo, hasSound, mode, range, onRange, onPlayhead, seekS }: RangeStripProps) {
  const { c } = useTheme();
  const [viewW, setViewW] = useState(0);
  const [zoom, setZoom] = useState<number>();
  const [held, setHeld] = useState(false);
  const [pinching, setPinching] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const playhead = useRef(0);
  const [headS, setHeadS] = useState(0);
  const pinch = useRef<{ d: number; z: number } | undefined>(undefined);

  const fit = durationS > EIGHT_SECONDS ? viewW / EIGHT_SECONDS : viewW / durationS;
  const px = clampZoom(zoom ?? fit, durationS, viewW);
  const limits = zoomLimits(durationS, viewW);
  const pad = viewW / 2;
  const trackW = (Number.isFinite(durationS) ? durationS : 0) * px;
  const { tiles, peaks } = useStripMedia(uri, durationS, hasVideo, hasSound, px, viewW > 0);

  const live = useRef({ range, durationS, px, onRange });
  live.current = { range, durationS, px, onRange };

  const grab = (edge: 'start' | 'end') => {
    let from = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { from = edge === 'start' ? live.current.range.startS : live.current.range.endS; setHeld(true); },
      onPanResponderMove: (_, g) => {
        const l = live.current;
        l.onRange(moveEdge(l.range, edge, from + g.dx / l.px, l.durationS));
      },
      onPanResponderRelease: () => setHeld(false),
      onPanResponderTerminate: () => setHeld(false),
    });
  };
  const startPan = useRef(grab('start')).current;
  const endPan = useRef(grab('end')).current;

  useEffect(() => {
    const id = requestAnimationFrame(() => scroller.current?.scrollTo({ x: playhead.current * px, animated: false }));
    return () => cancelAnimationFrame(id);
  }, [px]);

  useEffect(() => {
    if (seekS === undefined || Math.abs(seekS - playhead.current) < 0.05) return;
    playhead.current = seekS;
    setHeadS(seekS);
    scroller.current?.scrollTo({ x: seekS * live.current.px, animated: false });
  }, [seekS]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const last = mode === 'point' ? lastFrameS(durationS) : durationS;
    const t = snapTenth(Math.min(Math.max(e.nativeEvent.contentOffset.x / px, 0), last));
    if (t === playhead.current) return;
    playhead.current = t;
    setHeadS(t);
    onPlayhead(t);
  };

  const zoomBy = (factor: number) => setZoom(clampZoom(px * factor, durationS, viewW));

  // shortcut: a native scroll view can swallow the second finger on some phones; the two zoom buttons are the fallback, check on the phone.
  const touchDistance = (e: GestureResponderEvent) => {
    const [a, b] = e.nativeEvent.touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length !== 2) return;
    if (!pinch.current) { pinch.current = { d: touchDistance(e), z: px }; setPinching(true); return; }
    setZoom(clampZoom((pinch.current.z * touchDistance(e)) / pinch.current.d, durationS, viewW));
  };
  const endPinch = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length >= 2) return;
    pinch.current = undefined;
    setPinching(false);
  };

  const barCount = [100, 200, 400, 800].find(n => n * 3 >= trackW) ?? 800;
  const bars = useMemo(() => barsFor(peaks, barCount), [peaks, barCount]);
  const top = HEAD_H + RULER_H;
  const body = FILM_H + (bars.length ? WAVE_H + space.xs : 0);
  const startX = range.startS * px, endX = range.endS * px;
  const ranged = mode === 'range';

  return (
    <View onLayout={(e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width)} onTouchMove={onTouchMove} onTouchEnd={endPinch} onTouchCancel={endPinch} style={{ gap: space.sm }}>
      {viewW > 0 ? (
        <>
          <View style={{ height: top + body }}>
            <ScrollView
              ref={scroller}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={!held && !pinching}
              scrollEventThrottle={16}
              onScroll={onScroll}
            >
              <View style={{ width: trackW + viewW, height: top + body }}>
                <Ruler durationS={durationS} px={px} pad={pad} />
                <Film tiles={tiles} trackW={trackW} pad={pad} />

                {bars.length ? (
                  <>
                    <View style={{ position: 'absolute', top: top + FILM_H + space.xs, left: pad, width: trackW, height: WAVE_H }}>
                      <Bars bars={bars} color={c.muted} />
                    </View>
                    {ranged ? (
                      <View style={{ position: 'absolute', top: top + FILM_H + space.xs, left: pad + startX, width: endX - startX, height: WAVE_H, overflow: 'hidden' }}>
                        <View style={{ position: 'absolute', left: -startX, width: trackW, height: WAVE_H }}>
                          <Bars bars={bars} color={c.accent} />
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : null}

                {ranged ? (
                  <>
                    <View pointerEvents="none" style={{ position: 'absolute', top, left: pad, width: startX, height: FILM_H, backgroundColor: alpha(c.bg, 0.65) }} />
                    <View pointerEvents="none" style={{ position: 'absolute', top, left: pad + endX, width: Math.max(0, trackW - endX), height: FILM_H, backgroundColor: alpha(c.bg, 0.65) }} />
                    <View pointerEvents="none" style={{ position: 'absolute', top, left: pad + startX, width: endX - startX, height: FILM_H, borderWidth: 2, borderColor: c.accent }} />
                    <View
                      {...startPan.panHandlers}
                      accessibilityLabel="Start of the part to keep"
                      accessibilityHint="Drag to move where it starts"
                      style={{ position: 'absolute', top, left: pad + startX - HANDLE_W, width: HANDLE_W, height: FILM_H, alignItems: 'flex-end' }}
                    >
                      <Grip side="left" />
                    </View>
                    <View
                      {...endPan.panHandlers}
                      accessibilityLabel="End of the part to keep"
                      accessibilityHint="Drag to move where it ends"
                      style={{ position: 'absolute', top, left: pad + endX, width: HANDLE_W, height: FILM_H, alignItems: 'flex-start' }}
                    >
                      <Grip side="right" />
                    </View>
                  </>
                ) : null}
              </View>
            </ScrollView>

            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: pad - 30, width: 60, height: 20, borderRadius: radius.pill, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" style={{ color: c.bg }}>{timeText(headS)}</Text>
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', top: 20, bottom: 0, left: pad - 1, width: 2, backgroundColor: c.text }} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
            <Button label="Zoom out" variant="secondary" size="sm" disabled={px <= limits.min * 1.001} onPress={() => zoomBy(1 / 1.5)} />
            <Button label="Zoom in" variant="secondary" size="sm" disabled={px >= limits.max * 0.999} onPress={() => zoomBy(1.5)} />
            {ranged ? (
              <>
                <Button label="Start here" variant="secondary" size="sm" onPress={() => onRange(moveEdge(range, 'start', headS, durationS))} />
                <Button label="End here" variant="secondary" size="sm" onPress={() => onRange(moveEdge(range, 'end', headS, durationS))} />
              </>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Grip({ side }: { side: 'left' | 'right' }) {
  const { c } = useTheme();
  const r = radius.control;
  return (
    <View
      style={{
        width: GRIP_W, height: '100%', backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
        borderTopLeftRadius: side === 'left' ? r : 0, borderBottomLeftRadius: side === 'left' ? r : 0,
        borderTopRightRadius: side === 'right' ? r : 0, borderBottomRightRadius: side === 'right' ? r : 0,
      }}
    >
      <View style={{ width: 2, height: 18, borderRadius: 1, backgroundColor: c.onAccent }} />
    </View>
  );
}
