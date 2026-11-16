package expo.modules.haloengine.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class RandomMotionTest {
  @Test
  fun valuesInRangeAndContinuous() {
    for (seed in listOf(0, 1, 42, -7)) {
      val prev = FloatArray(32)
      val cur = FloatArray(32)
      val lo = FloatArray(32) { 1f }
      val hi = FloatArray(32)
      RandomMotion.fill(prev, 5_000L, seed)
      for (f in 1..2000) {
        RandomMotion.fill(cur, 5_000L + f * 16L, seed)
        for (b in 0 until 32) {
          assertTrue("seed $seed band $b value ${cur[b]}", cur[b] in 0f..1f)
          assertTrue("seed $seed band $b jump ${abs(cur[b] - prev[b])}", abs(cur[b] - prev[b]) < 0.1f)
          lo[b] = minOf(lo[b], cur[b]); hi[b] = maxOf(hi[b], cur[b])
        }
        cur.copyInto(prev)
      }
      for (b in 0 until 32) assertTrue("seed $seed band $b moves", hi[b] - lo[b] > 0.3f)
    }
  }

  @Test
  fun seedChangesMotion() {
    val a = FloatArray(32)
    val b = FloatArray(32)
    RandomMotion.fill(a, 12_345L, 1)
    RandomMotion.fill(b, 12_345L, 2)
    assertFalse(a.contentEquals(b))
  }
}
