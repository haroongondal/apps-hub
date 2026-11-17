package expo.modules.haloengine.core

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.hypot

class BurnInTest {
  private val maxPx = 36f // 12 dp at 3x density
  private val start = 1_795_000_000_000L // a realistic wall-clock time (2026)

  @Test
  fun movesEveryMinuteWithinBounds() {
    val a = FloatArray(2)
    val b = FloatArray(2)
    // A whole night of minutes, each sampled at its start and half-way through.
    for (m in 0 until 24 * 60) {
      val t = start + m * 60_000L
      for (dt in longArrayOf(0L, 30_000L)) {
        BurnIn.offset(t + dt, maxPx, a)
        assertTrue("minute $m +$dt: (${a[0]}, ${a[1]})", a[0].isFinite() && a[1].isFinite())
        assertTrue("minute $m +$dt dx ${a[0]}", abs(a[0]) <= maxPx)
        assertTrue("minute $m +$dt dy ${a[1]}", abs(a[1]) <= maxPx)
      }
      BurnIn.offset(t, maxPx, a)
      BurnIn.offset(t + 60_000L, maxPx, b)
      val moved = hypot(b[0] - a[0], b[1] - a[1])
      assertTrue("minute $m moved only $moved px", moved >= 1f)
    }
  }

  @Test
  fun smooth() {
    val a = FloatArray(2)
    val b = FloatArray(2)
    BurnIn.offset(start, maxPx, a)
    for (s in 1..3 * 3600) {
      BurnIn.offset(start + s * 1000L, maxPx, b)
      val step = hypot(b[0] - a[0], b[1] - a[1])
      assertTrue("second $s step $step px", step <= 1f)
      a[0] = b[0]
      a[1] = b[1]
    }
  }
}
