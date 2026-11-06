package expo.modules.designmedia.core

import kotlin.math.abs

// Loudest sample per equal slice of a sound's length, for the waveform row. Samples are 16-bit, interleaved across
// channels; the result is each slice's largest absolute sample over 32768, so 0 is silence and 1 is full scale.
class PeakBuckets(private val durationUs: Long, buckets: Int) {
  private val loudest = IntArray(maxOf(buckets, 1))

  // ptsUs is the time of the first frame in pcm; a frame is one sample per channel.
  fun add(ptsUs: Long, pcm: ShortArray, channels: Int, sampleRate: Int) {
    if (durationUs <= 0 || channels <= 0 || sampleRate <= 0) return
    for (frame in 0 until pcm.size / channels) {
      val us = ptsUs + frame * 1_000_000L / sampleRate
      // samples past the end (a decoder's padding) go in the last slice
      val slice = (us * loudest.size / durationUs).coerceIn(0L, (loudest.size - 1).toLong()).toInt()
      for (c in 0 until channels) loudest[slice] = maxOf(loudest[slice], abs(pcm[frame * channels + c].toInt()))
    }
  }

  fun result(): List<Float> = loudest.map { minOf(it / 32768f, 1f) }
}
