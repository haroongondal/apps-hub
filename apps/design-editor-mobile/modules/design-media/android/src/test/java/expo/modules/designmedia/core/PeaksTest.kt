package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PeaksTest {
  private val rate = 8000
  private val loud: Short = 16384

  // 10 s at 8000 Hz, loud only from 2.0 s up to (not including) 3.0 s, handed over in chunks the way a decoder does
  private fun feed(peaks: PeakBuckets, channels: Int, loudChannel: Int) {
    val chunkFrames = 1000
    for (start in 0 until 10 * rate step chunkFrames) {
      val pcm = ShortArray(chunkFrames * channels) { i ->
        val frame = start + i / channels
        if (frame in 2 * rate until 3 * rate && i % channels == loudChannel) loud else 0
      }
      peaks.add(start * 1_000_000L / rate, pcm, channels, rate)
    }
  }

  private fun expected() = List(10) { if (it == 2) 0.5f else 0f }

  @Test
  fun monoLoudSecondFillsOnlyItsSlice() {
    val peaks = PeakBuckets(10_000_000, 10)
    feed(peaks, 1, 0)
    assertEquals(expected(), peaks.result())
  }

  @Test
  fun stereoWithSoundOnTheRightChannelOnlyGivesTheSameResult() {
    val peaks = PeakBuckets(10_000_000, 10)
    feed(peaks, 2, 1)
    assertEquals(expected(), peaks.result())
  }

  @Test
  fun aSampleAfterTheEndLandsInTheLastSlice() {
    val peaks = PeakBuckets(10_000_000, 10)
    peaks.add(12_000_000, shortArrayOf(loud), 1, rate)
    assertEquals(List(10) { if (it == 9) 0.5f else 0f }, peaks.result())
  }

  @Test
  fun aNegativeFullScaleSampleCountsAsOne() {
    val peaks = PeakBuckets(10_000_000, 2)
    peaks.add(0, shortArrayOf(Short.MIN_VALUE), 1, rate)
    assertEquals(listOf(1f, 0f), peaks.result())
  }

  @Test
  fun noDurationGivesAllZeros() {
    val peaks = PeakBuckets(0, 4)
    peaks.add(0, shortArrayOf(loud, loud), 1, rate)
    assertEquals(listOf(0f, 0f, 0f, 0f), peaks.result())
  }

  @Test
  fun zeroBucketsStillGivesOneEntry() {
    assertEquals(1, PeakBuckets(1_000_000, 0).result().size)
    assertTrue(PeakBuckets(1_000_000, -3).result().size == 1)
  }
}
