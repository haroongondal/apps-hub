/**
 * Traffic ring buffer — the UI-side sample store for `onTrafficUpdate`
 * deltas. The native ~1 Hz ticker is the only cadence source; this class
 * never schedules anything. Capacity ~60 samples (phase-4 plan §4): enough
 * for a minute of recent throughput, bounded so a long session cannot grow
 * the display set.
 */

export interface TrafficSample {
  readonly bytesIn: number;
  readonly bytesOut: number;
}

export const RING_CAPACITY = 60;

/** How many recent samples the smoothed readout averages. */
export const SMOOTHED_SAMPLE_COUNT = 10;

/** One native tick, structurally mirrored from the tunnel client's
 * snapshot (which satisfies this shape as-is). */
export interface TrafficTick {
  readonly bytesIn: number;
  readonly bytesOut: number;
  readonly connectedDurationSec: number;
}

export class TrafficRingBuffer {
  private readonly capacity: number;
  private samples: TrafficSample[] = [];

  constructor(capacity: number = RING_CAPACITY) {
    this.capacity = capacity;
  }

  /** Pushes the latest native tick; newest ends up first. Only the byte
   * fields are retained for display. */
  push(traffic: TrafficTick): void {
    this.samples = [
      { bytesIn: traffic.bytesIn, bytesOut: traffic.bytesOut },
      ...this.samples,
    ].slice(0, this.capacity);
  }

  clear(): void {
    this.samples = [];
  }

  /** Newest-first view; callers must not mutate it. */
  all(): readonly TrafficSample[] {
    return this.samples;
  }

  /** Average over the newest `count` samples, or null with no data. */
  recentAverage(count: number = SMOOTHED_SAMPLE_COUNT): TrafficSample | null {
    if (this.samples.length === 0) return null;
    const recent = this.samples.slice(0, Math.max(1, Math.min(count, this.samples.length)));
    let bytesIn = 0;
    let bytesOut = 0;
    for (const sample of recent) {
      bytesIn += sample.bytesIn;
      bytesOut += sample.bytesOut;
    }
    return {
      bytesIn: bytesIn / recent.length,
      bytesOut: bytesOut / recent.length,
    };
  }
}

export interface SparklineBar {
  /** Normalized 0..1 height for the display; 0 renders as a hairline. */
  readonly height: number;
  /** True when no traffic moved in this bucket (honest blank, not a dip). */
  readonly idle: boolean;
}

/**
 * Reduces the newest-first sample ring into `buckets` chronological bars.
 * Newest lands at the right end, live-chart style; when fewer samples
 * exist than buckets, the older buckets stay honestly idle instead of
 * stretching or inventing traffic. Bars average the samples that fall
 * into them; a zero-traffic bucket is idle, never a dip.
 */
export function sparklineBars(
  samples: readonly TrafficSample[],
  buckets = 24,
): SparklineBar[] {
  if (buckets < 1) return [];
  const chronological = [...samples].reverse();
  const bars: SparklineBar[] = [];
  let max = 0;

  if (chronological.length <= buckets) {
    // Anchor the existing samples at the newest end; older buckets idle.
    const offset = buckets - chronological.length;
    const totals: Array<number | null> = new Array(buckets).fill(null);
    chronological.forEach((sample, index) => {
      totals[offset + index] = sample.bytesIn + sample.bytesOut;
    });
    for (const total of totals) {
      if (total === null) {
        bars.push({ height: 0, idle: true });
        continue;
      }
      max = Math.max(max, total);
      bars.push({ height: total, idle: total === 0 });
    }
  } else {
    for (let index = 0; index < buckets; index += 1) {
      const start = Math.floor((index * chronological.length) / buckets);
      const end = Math.max(start + 1, Math.floor(((index + 1) * chronological.length) / buckets));
      const slice = chronological.slice(start, end);
      let total = 0;
      for (const sample of slice) total += sample.bytesIn + sample.bytesOut;
      const average = total / slice.length;
      max = Math.max(max, average);
      bars.push({ height: average, idle: average === 0 });
    }
  }

  return bars.map((bar) => ({
    height: max > 0 ? bar.height / max : 0,
    idle: bar.idle,
  }));
}
