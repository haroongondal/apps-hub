package expo.modules.pdfscan.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuadStabilizerTest {
  private var now = 0L
  private val stab = QuadStabilizer(StabilizerConfig()) { now }
  private val base = doubleArrayOf(0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8)

  private fun det(dx: Double = 0.0, sharp: Double = 200.0, thumb: Int = 100) =
    Detection(DoubleArray(8) { if (it % 2 == 0) base[it] + dx else base[it] }, 4.0 / 3, sharp, ByteArray(32 * 32) { thumb.toByte() })

  /** Feeds frames every 33 ms for [ms]; returns how many fired. */
  private fun run(ms: Long, focused: Boolean = true, auto: Boolean = true, make: (Int) -> Detection?): Int {
    var fired = 0
    var i = 0
    val end = now + ms
    while (now < end) {
      if (stab.update(make(i++), focused, auto).fire) fired++
      now += 33
    }
    return fired
  }

  @Test fun steadyPageFiresAfterTheHold() {
    var firedAt = -1L
    val start = now
    while (now - start < 1500 && firedAt < 0) {
      if (stab.update(det(), true, true).fire) firedAt = now - start
      now += 33
    }
    assertTrue("fired at $firedAt", firedAt in 800..900)
  }

  @Test fun ringRisesWhileHolding() {
    stab.update(det(), true, true)
    now += 400
    val step = stab.update(det(), true, true)
    assertEquals(0.5, step.steady, 0.01)
    assertEquals(ScanHint.HOLD, step.hint)
  }

  @Test fun jitterOfThreePercentNeverFires() {
    assertEquals(0, run(3000) { i -> det(dx = if (i % 2 == 0) 0.0 else 0.04) })
  }

  @Test fun blurryAndFocusingPauseTheHold() {
    assertEquals(0, run(2000) { det(sharp = 10.0) })
    assertEquals(ScanHint.BLURRY, stab.update(det(sharp = 10.0), true, true).hint)
    assertEquals(0, run(2000, focused = false) { det() })
    assertEquals(ScanHint.FOCUSING, stab.update(det(), false, true).hint)
    assertEquals(1, run(1000) { det() })
  }

  @Test fun samePageIsNotTakenTwice() {
    assertEquals(1, run(1000) { det() })
    assertEquals(0, run(5000) { det() })
    assertEquals(StabilizerState.COOLDOWN, stab.state)
  }

  @Test fun turnedPageRearms() {
    assertEquals(1, run(1000) { det() })
    assertEquals(1, run(1200) { det(thumb = 160) })
  }

  @Test fun pageRemovedThenBackRearms() {
    assertEquals(1, run(1000) { det() })
    run(500) { null }
    assertEquals(StabilizerState.SEARCHING, stab.state)
    assertEquals(1, run(1000) { det() })
  }

  @Test fun briefDropoutKeepsHolding() {
    stab.update(det(), true, true)
    now += 100
    val step = stab.update(null, true, true)
    assertEquals(ScanHint.HOLD, step.hint)
    assertEquals(StabilizerState.HOLDING, stab.state)
    now += 250
    assertEquals(ScanHint.SEARCHING, stab.update(null, true, true).hint)
  }

  @Test fun manualModeNeverFiresButManualShutterCoolsDown() {
    assertEquals(0, run(3000, auto = false) { det() })
    stab.manualCapture(det())
    assertEquals(StabilizerState.COOLDOWN, stab.state)
    assertFalse(stab.update(det(), true, true).fire)
  }
}
