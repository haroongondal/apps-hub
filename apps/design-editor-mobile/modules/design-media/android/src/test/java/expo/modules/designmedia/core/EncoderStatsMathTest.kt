package expo.modules.designmedia.core

import org.junit.Assert.assertEquals
import org.junit.Test

class EncoderStatsMathTest {
  @Test
  fun correctionIsOneWithoutHistory() {
    assertEquals(1.0, EncoderStatsMath.correction(emptyList()), 0.0)
  }

  @Test
  fun correctionIsTheMedianOfTheLastFive() {
    assertEquals(1.10, EncoderStatsMath.correction(listOf(9.0, 1.0, 1.1, 1.2, 1.05)), 1e-9)
    assertEquals(1.125, EncoderStatsMath.correction(listOf(1.0, 1.25)), 1e-9)
  }

  @Test
  fun correctionIsClampedToZeroPointEightToOnePointFive() {
    assertEquals(1.5, EncoderStatsMath.correction(listOf(3.0)), 0.0)
    assertEquals(0.8, EncoderStatsMath.correction(listOf(0.2, 0.3)), 0.0)
  }

  @Test
  fun storeKeepsOnlyTheLastFiveRatiosPerKey() {
    val store = EncoderStatsStore(FakeTextFile())
    (1..7).forEach { store.record("hw-h264/vbr", it.toDouble()) }
    store.record("hw-hevc/cbr", 1.3)
    assertEquals(listOf(3.0, 4.0, 5.0, 6.0, 7.0), store.all()["hw-h264/vbr"])
    assertEquals(listOf(1.3), store.all()["hw-hevc/cbr"])
  }
}
