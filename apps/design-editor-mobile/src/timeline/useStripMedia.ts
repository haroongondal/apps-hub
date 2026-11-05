import { thumbCount, thumbTimes } from '@apps-hub/media-core';
import DesignMedia from 'design-media';
import { useEffect, useMemo, useRef, useState } from 'react';

import { singleFlight } from './latest';

// `ready` is false until the strip knows its width, so the first request is already the right size.
export function useStripMedia(uri: string, durationS: number, hasVideo: boolean, hasSound: boolean, pxPerS: number, ready: boolean) {
  const [tiles, setTiles] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const current = useRef(uri);
  current.current = uri;
  const haveTiles = useRef(false);
  const count = thumbCount(durationS, pxPerS);

  const load = useMemo(() => singleFlight(
    (a: { uri: string; times: number[] }) => DesignMedia.thumbnails(a.uri, a.times, 160),
    (t, a) => { if (a.uri === current.current) { haveTiles.current = true; setTiles(t); } },
    (_, a) => { if (a.uri === current.current) setTiles([]); },
  ), []);

  useEffect(() => { haveTiles.current = false; setTiles([]); }, [uri]);

  useEffect(() => {
    if (!hasVideo || !ready) return;
    // A pinch changes the count many times a second; wait for it to settle, but load the first set at once.
    const timer = setTimeout(() => load({ uri, times: thumbTimes(durationS, count) }), haveTiles.current ? 300 : 0);
    return () => clearTimeout(timer);
  }, [uri, durationS, hasVideo, ready, count, load]);

  useEffect(() => {
    setPeaks([]);
    if (!hasSound) return;
    let live = true;
    DesignMedia.waveform(uri, 400).then(p => { if (live) setPeaks(p); }, () => undefined);
    return () => { live = false; };
  }, [uri, hasSound]);

  return { tiles, peaks };
}
