import { thumbCount, thumbTimes } from '@apps-hub/media-core';
import DesignMedia from 'design-media';
import { useEffect, useRef, useState } from 'react';

import { createLatest } from './latest';

export function useStripMedia(uri: string, durationS: number, hasVideo: boolean, hasSound: boolean, pxPerS: number) {
  const [tiles, setTiles] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const latest = useRef(createLatest<string[]>()).current;
  const haveTiles = useRef(false);
  const count = thumbCount(durationS, pxPerS);

  useEffect(() => { haveTiles.current = false; setTiles([]); }, [uri]);

  useEffect(() => {
    if (!hasVideo) return;
    // A pinch changes the count many times a second; wait for it to settle, but load the first set at once.
    const timer = setTimeout(() => {
      latest(DesignMedia.thumbnails(uri, thumbTimes(durationS, count), 160)).then(
        t => { if (t) { haveTiles.current = true; setTiles(t); } },
        () => setTiles([]),
      );
    }, haveTiles.current ? 300 : 0);
    return () => clearTimeout(timer);
  }, [uri, durationS, hasVideo, count, latest]);

  useEffect(() => {
    setPeaks([]);
    if (!hasSound) return;
    let live = true;
    DesignMedia.waveform(uri, 400).then(p => { if (live) setPeaks(p); }, () => undefined);
    return () => { live = false; };
  }, [uri, hasSound]);

  return { tiles, peaks };
}
