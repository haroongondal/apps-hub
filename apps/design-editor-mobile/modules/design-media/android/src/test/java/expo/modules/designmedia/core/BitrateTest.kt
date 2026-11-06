package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BitrateTest {
  @Test
  fun qualityIsBitsPerPixelTimesPixelsTimesFps() {
    assertEquals(6_220_800, qualityBps(0.10, 1920, 1080, 30, null))
    assertEquals(1_806_336, qualityBps(0.07, 1280, 720, 28, null))
  }

  @Test
  fun theRateIsCappedAtWhatTheSourceAlreadyUses() {
    assertEquals(4_000_000, qualityBps(0.14, 1920, 1080, 30, 4_000_000))
    assertEquals(6_220_800, qualityBps(0.10, 1920, 1080, 30, 20_000_000))
    assertEquals(6_220_800, qualityBps(0.10, 1920, 1080, 30, 0))
  }

  @Test
  fun theSourceRateIsTheTrackFigureElseTheFileAverageMinusSound() {
    assertEquals(8_000_000, estimateVideoBps(8_000_000, 1, 1.0, null))
    assertEquals(7_872_000, estimateVideoBps(null, 10_000_000, 10.0, 128_000))
    assertNull(estimateVideoBps(null, 0, 10.0, null))
    assertNull(estimateVideoBps(null, 1_000, 10.0, 128_000))
  }

  @Test
  fun hevcKeepsSeventyPercentAndH264KeepsTheSourceRate() {
    assertEquals(5_600_000, convertBps("hw-hevc", 8_000_000))
    assertEquals(8_000_000, convertBps("hw-h264", 8_000_000))
    assertNull(convertBps("hw-h264", null))
  }

  @Test
  fun freeSpaceNeededFollowsSpecSection111() {
    val plans = decodeSamples()
    assertEquals(2 * 18_000_000L, neededBytes(plans.getValue("size"), 99, 0.0))
    assertEquals(50_000_000L, neededBytes(plans.getValue("reverse"), 50_000_000, 8.0))
    assertEquals(16_000_000L, neededBytes(plans.getValue("gif"), 99, 0.0))
    assertEquals(40_000_000L, neededBytes(plans.getValue("gifNoTarget"), 99, 0.0))
    assertEquals(25_000_000L, neededBytes(plans.getValue("frame"), 99, 0.0))
  }

  @Test
  fun aClipNeedsOnlyItsShareOfTheSource() {
    val clip = decodeSamples().getValue("clipCopy") as ClipPlan
    assertEquals(50_000_000L, neededBytes(clip, 50_000_000, 0.0))
    assertEquals(57_750_000.0, neededBytes(clip, 1_000_000_000, 100.0).toDouble(), 1.0)
    assertEquals(1_100_000_000.0, neededBytes(clip.copy(startS = 0.0, endS = 500.0, keyframeS = 0.0), 1_000_000_000, 100.0).toDouble(), 1.0)
  }
}
