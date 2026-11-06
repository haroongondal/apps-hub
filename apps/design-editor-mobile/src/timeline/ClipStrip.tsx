import {
  barsFor, clampZoom, clipLengthS, clipSpans, followTarget, musicLengthS, musicSpans, snapTenth, thumbCount, thumbTimes, totalS, zoomLimits,
  type Clip, type Music, type Project,
} from '@apps-hub/media-core';
import { Button, Text, radius, space, useTheme } from '@apps-hub/ui';
import DesignMedia from 'design-media';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image, Pressable, ScrollView, View,
  type GestureResponderEvent, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';

import { timeText } from '../media/tools';
import { singleFlight } from './latest';
import { Bars, EIGHT_SECONDS, FILM_H, HEAD_H, RULER_H, Ruler } from './RangeStrip';

export interface ClipStripProps {
  project: Project;
  selectedId?: string;
  onSelect: (id: string) => void;
  seekS?: number; // the player's time while it plays: the strip follows it without calling onPlayhead
  onPlayhead: (timelineS: number) => void;
  onDrag?: (dragging: boolean) => void;
  selectedMusicId?: string;
  onSelectMusic: (id: string) => void;
}

// Twenty clips asking at once would open twenty decoders, so picture reads from every clip queue behind each other.
let chain: Promise<unknown> = Promise.resolve();
const FOLDER = 'video'; // each clip's pictures live in their own folder, or one clip's set would delete another's
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

const ClipBlock = memo(function ClipBlock({ clip, index, leftPx, widthPx, px, selected, onSelect }: {
  clip: Clip; index: number; leftPx: number; widthPx: number; px: number; selected: boolean; onSelect: (id: string) => void;
}) {
  const { c } = useTheme();
  const [tiles, setTiles] = useState<string[]>([]);
  const lengthS = clipLengthS(clip);
  const count = Math.max(1, Math.min(thumbCount(lengthS, px), Math.ceil(widthPx / 24)));
  const key = `${clip.source.uri}|${clip.inS}|${clip.outS}|${count}`;
  const wanted = useRef(key);
  wanted.current = key;
  const haveTiles = useRef(false);

  const load = useMemo(() => singleFlight(
    (a: { key: string; uri: string; times: number[]; folder: string }) => oneAtATime(() => DesignMedia.thumbnails(a.uri, a.times, 160, a.folder)),
    (t, a) => { if (a.key === wanted.current) { haveTiles.current = true; setTiles(t); } },
  ), []);

  useEffect(() => {
    const times = thumbTimes(lengthS, count).map(t => clip.inS + t);
    const timer = setTimeout(() => load({ key, uri: clip.source.uri, times, folder: `${FOLDER}/${clip.id}` }), haveTiles.current ? 300 : 0);
    return () => clearTimeout(timer);
  }, [key, clip.source.uri, clip.id, clip.inS, lengthS, count, load]);

  return (
    <Pressable
      onPress={() => onSelect(clip.id)}
      accessibilityRole="button"
      accessibilityLabel={`Clip ${index + 1}, ${timeText(lengthS)}`}
      accessibilityState={{ selected }}
      style={{
        position: 'absolute', top: HEAD_H + RULER_H, left: leftPx, width: widthPx, height: FILM_H, flexDirection: 'row',
        backgroundColor: c.raised, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: selected ? c.accent : c.bg,
      }}
    >
      {tiles.map((t, i) => (
        <Image key={`${i}-${t}`} source={{ uri: t }} resizeMode="cover" style={{ flex: 1, height: FILM_H }} />
      ))}
    </Pressable>
  );
});

const PEAKS = 400;
const MUSIC_H = 48; // a touch target, taller than the waveform it holds

// The sound of the whole file is read once; the block shows the part between inS and outS.
const MusicBlock = memo(function MusicBlock({ music, index, top, leftPx, widthPx, selected, onSelect }: {
  music: Music; index: number; top: number; leftPx: number; widthPx: number; selected: boolean; onSelect: (id: string) => void;
}) {
  const { c } = useTheme();
  const [peaks, setPeaks] = useState<{ uri: string; peaks: number[] }>();
  const load = useMemo(() => singleFlight(
    (uri: string) => oneAtATime(() => DesignMedia.waveform(uri, PEAKS)),
    (p, uri) => setPeaks({ uri, peaks: p }),
  ), []);
  useEffect(() => { load(music.source.uri); }, [music.source.uri, load]);

  const bars = useMemo(() => {
    if (peaks?.uri !== music.source.uri || !peaks.peaks.length) return [];
    const n = peaks.peaks.length, d = music.source.durationS;
    const lo = Math.floor((music.inS / d) * n), hi = Math.max(lo + 1, Math.ceil((music.outS / d) * n));
    return barsFor(peaks.peaks.slice(lo, hi), Math.max(1, Math.min(200, Math.floor(widthPx / 3))));
  }, [peaks, music.source.uri, music.source.durationS, music.inS, music.outS, widthPx]);

  return (
    <Pressable
      onPress={() => onSelect(music.id)}
      accessibilityRole="button"
      accessibilityLabel={`Music ${index + 1}, ${timeText(musicLengthS(music))}`}
      accessibilityState={{ selected }}
      style={{
        position: 'absolute', top, left: leftPx, width: widthPx, height: MUSIC_H, paddingHorizontal: 2,
        backgroundColor: c.raised, borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: selected ? c.accent : c.bg,
      }}
    >
      <Bars bars={bars} color={selected ? c.accent : c.muted} />
    </Pressable>
  );
});

export function ClipStrip({ project, selectedId, onSelect, seekS, onPlayhead, onDrag, selectedMusicId, onSelectMusic }: ClipStripProps) {
  const { c } = useTheme();
  const durationS = totalS(project);
  const [viewW, setViewW] = useState(0);
  const [zoom, setZoom] = useState<number>();
  const [pinching, setPinching] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const playhead = useRef(0);
  const [headS, setHeadS] = useState(0);
  const pinch = useRef<{ d: number; z: number } | undefined>(undefined);

  const fit = durationS > EIGHT_SECONDS ? viewW / EIGHT_SECONDS : viewW / durationS;
  const px = clampZoom(zoom ?? fit, durationS, viewW);
  const limits = zoomLimits(durationS, viewW);
  const pad = viewW / 2;
  const trackW = durationS * px;
  const spans = useMemo(() => clipSpans(project, px), [project, px]);
  const tunes = useMemo(() => musicSpans(project, px), [project, px]);
  const live = useRef(px);
  live.current = px;
  const dragging = useRef(false);

  useEffect(() => () => { void DesignMedia.clearThumbs(FOLDER).catch(() => undefined); }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => scroller.current?.scrollTo({ x: playhead.current * px, animated: false }));
    return () => cancelAnimationFrame(id);
  }, [px]);

  // Snapped first, so the scroll this causes finds the playhead already there and does not report it back.
  useEffect(() => {
    const t = followTarget(seekS, playhead.current, dragging.current);
    if (t === undefined) return;
    playhead.current = t;
    setHeadS(t);
    scroller.current?.scrollTo({ x: t * live.current, animated: false });
  }, [seekS]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const t = snapTenth(Math.min(Math.max(e.nativeEvent.contentOffset.x / px, 0), durationS));
    if (t === playhead.current) return;
    playhead.current = t;
    setHeadS(t);
    onPlayhead(t);
  };

  const zoomBy = (factor: number) => setZoom(clampZoom(px * factor, durationS, viewW));

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

  const top = HEAD_H + RULER_H;
  const musicTop = top + FILM_H + space.xs;
  const height = project.music.length ? musicTop + MUSIC_H : top + FILM_H;

  return (
    <View onLayout={(e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width)} onTouchMove={onTouchMove} onTouchEnd={endPinch} onTouchCancel={endPinch} style={{ gap: space.sm }}>
      {viewW > 0 ? (
        <>
          <View style={{ height }}>
            <ScrollView
              ref={scroller}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={!pinching}
              scrollEventThrottle={16}
              onScroll={onScroll}
              onScrollBeginDrag={() => { dragging.current = true; onDrag?.(true); }}
              onScrollEndDrag={() => { dragging.current = false; onDrag?.(false); }}
            >
              <View style={{ width: trackW + viewW, height }}>
                <Ruler durationS={durationS} px={px} pad={pad} />
                {project.clips.map((clip, i) => (
                  <ClipBlock
                    key={clip.id}
                    clip={clip}
                    index={i}
                    leftPx={pad + spans[i].leftPx}
                    widthPx={spans[i].widthPx}
                    px={px}
                    selected={clip.id === selectedId}
                    onSelect={onSelect}
                  />
                ))}
                {project.music.map((m, i) => (
                  <MusicBlock
                    key={m.id}
                    music={m}
                    index={i}
                    top={musicTop}
                    leftPx={pad + tunes[i].leftPx}
                    widthPx={tunes[i].widthPx}
                    selected={m.id === selectedMusicId}
                    onSelect={onSelectMusic}
                  />
                ))}
              </View>
            </ScrollView>

            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: pad - 30, width: 60, height: 20, borderRadius: radius.pill, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="caption" style={{ color: c.bg }}>{timeText(headS)}</Text>
            </View>
            <View pointerEvents="none" style={{ position: 'absolute', top: 20, bottom: 0, left: pad - 1, width: 2, backgroundColor: c.text }} />
          </View>

          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Button label="Zoom out" variant="secondary" size="sm" disabled={px <= limits.min * 1.001} onPress={() => zoomBy(1 / 1.5)} />
            <Button label="Zoom in" variant="secondary" size="sm" disabled={px >= limits.max * 0.999} onPress={() => zoomBy(1.5)} />
          </View>
        </>
      ) : null}
    </View>
  );
}
