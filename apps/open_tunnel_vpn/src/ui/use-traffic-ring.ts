/**
 * Traffic-ring hook — binds the pure {@link TrafficRingBuffer} to the
 * client's traffic snapshots. The effect keys on the snapshot object the
 * tunnel client hands out, so each native tick pushes exactly one sample
 * and state-only commits push nothing. No timers: the native ticker is the
 * only cadence source (phase-4 plan §4).
 */
import { useEffect, useRef, useState } from 'react';

import type { TunnelTrafficSnapshot } from '../tunnel/tunnel-client.ts';
import { TrafficRingBuffer } from './traffic-samples.ts';

export interface TrafficRingHandle {
  ring: TrafficRingBuffer;
  /** Bumped on every push/clear so callers re-render. */
  revision: number;
}

export function useTrafficRing(traffic: TunnelTrafficSnapshot | null): TrafficRingHandle {
  const ringRef = useRef<TrafficRingBuffer | null>(null);
  if (ringRef.current === null) ringRef.current = new TrafficRingBuffer();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    if (traffic === null) {
      ring.clear();
    } else {
      ring.push(traffic);
    }
    setRevision((current) => current + 1);
  }, [traffic]);

  return { ring: ringRef.current, revision };
}
