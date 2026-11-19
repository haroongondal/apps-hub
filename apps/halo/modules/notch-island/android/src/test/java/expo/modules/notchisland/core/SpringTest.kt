package expo.modules.notchisland.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpringTest {
  private val curve = (0..Spring.SETTLE_MS.toInt()).map { Spring.value(it.toLong()) }

  @Test fun startsAtZeroAndSettlesAtExactlyOne() {
    assertEquals(0f, Spring.value(0), 0f)
    assertEquals(0f, Spring.value(-50), 0f)
    assertEquals(1f, Spring.value(Spring.SETTLE_MS), 0f)
    assertEquals(1f, Spring.value(5_000), 0f)
  }

  // Damping 0.8 overshoots by exp(-0.8 * pi / 0.6), about 1.5 %.
  @Test fun overshootsOnceThenComesBack() {
    val peak = curve.max()
    assertTrue("peak $peak", peak > 1.01f && peak < 1.03f)
    assertTrue(curve.indexOfFirst { it > 1f } in 150..300)
    assertEquals(1f, curve[curve.size - 2], 0.002f)
  }

  @Test fun neverDipsBelowZero() {
    assertTrue(curve.all { it >= 0f })
  }

  @Test fun contentFadesInLateAndOutEarly() {
    assertEquals(0f, Spring.openAlpha(0.4f), 0f)
    assertEquals(0.5f, Spring.openAlpha(0.7f), 0.0001f)
    assertEquals(1f, Spring.openAlpha(1.05f), 0f)
    assertEquals(1f, Spring.closeAlpha(0f), 0f)
    assertEquals(0f, Spring.closeAlpha(0.4f), 0f)
    assertEquals(0.92f, Spring.contentScale(0f), 0.0001f)
    assertEquals(1f, Spring.contentScale(1f), 0.0001f)
  }
}
