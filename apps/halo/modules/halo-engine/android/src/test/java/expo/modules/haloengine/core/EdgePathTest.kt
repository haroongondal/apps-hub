package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class EdgePathTest {
  private val zero4 = floatArrayOf(0f, 0f, 0f, 0f)
  private fun at(p: EdgePath, t: Float) = EdgePoint().also { p.at(t, it) }

  @Test
  fun rectangleLength() {
    val p = EdgePath(1080f, 2400f, zero4, floatArrayOf(10f, 20f, 30f, 40f))
    assertEquals(2 * (1040f + 2340f), p.length, 0.01f)
  }

  @Test
  fun startsTopCentre() {
    val p = EdgePath(1000f, 2000f, floatArrayOf(80f, 80f, 80f, 80f), floatArrayOf(0f, 0f, 0f, 0f))
    val e = at(p, 0f)
    assertEquals(500f, e.x, 0.01f)
    assertEquals(0f, e.y, 0.01f)
  }

  @Test
  fun quarterIsRightEdgeOnSquare() {
    val p = EdgePath(100f, 100f, zero4, zero4)
    val e = at(p, 0.25f)
    assertEquals(100f, e.x, 0.01f)
    assertEquals(50f, e.y, 0.01f)
    assertEquals(-1f, e.nx, 0.001f)
    val b = at(p, 0.5f)
    assertEquals(50f, b.x, 0.01f)
    assertEquals(100f, b.y, 0.01f)
    val l = at(p, 0.75f)
    assertEquals(0f, l.x, 0.01f)
    assertEquals(50f, l.y, 0.01f)
  }

  @Test
  fun arcPointsAreRadiusFromCentre() {
    val r = 100f
    val p = EdgePath(1000f, 2000f, floatArrayOf(r, r, r, r), zero4)
    val e = EdgePoint()
    // Top-right arc spans the stretch between the top straight and the right straight.
    val topStraight = 500f - r
    val s0 = topStraight / p.length
    val arc = (Math.PI.toFloat() / 2 * r) / p.length
    for (i in 1..9) {
      p.at(s0 + arc * i / 10f, e)
      assertEquals(r, hypot(e.x - (1000f - r), e.y - r), 0.05f)
    }
  }

  @Test
  fun normalsAreUnitAndInward() {
    val p = EdgePath(1080f, 2400f, floatArrayOf(120f, 90f, 60f, 150f), floatArrayOf(5f, 10f, 15f, 20f))
    val e = EdgePoint()
    for (i in 0 until 400) {
      p.at(i / 400f, e)
      assertEquals(1f, hypot(e.nx, e.ny), 0.001f)
      // One step along the normal moves toward the middle of the screen.
      val cx = 540f; val cy = 1200f
      val before = hypot(e.x - cx, e.y - cy)
      val after = hypot(e.x + e.nx * 2f - cx, e.y + e.ny * 2f - cy)
      assertTrue("t=${i / 400f}", after < before)
    }
  }

  @Test
  fun wrapsNegativeAndAboveOne() {
    val p = EdgePath(1080f, 2400f, floatArrayOf(100f, 100f, 100f, 100f), floatArrayOf(0f, 0f, 0f, 0f))
    val a = at(p, 0.3f)
    for (t in floatArrayOf(1.3f, -0.7f, 5.3f)) {
      val b = at(p, t)
      assertEquals(a.x, b.x, 0.05f)
      assertEquals(a.y, b.y, 0.05f)
    }
    val z = at(p, 1f)
    assertEquals(540f, z.x, 0.01f)
  }

  @Test
  fun rebuildsForLandscape() {
    val corners = floatArrayOf(120f, 120f, 120f, 120f)
    val ins = floatArrayOf(4f, 4f, 4f, 4f)
    for ((w, h) in listOf(1080f to 2400f, 2400f to 1080f)) {
      val p = EdgePath(w, h, corners, ins)
      val e = EdgePoint()
      for (i in 0 until 500) {
        p.at(i / 500f, e)
        assertTrue(e.x in 0f..w)
        assertTrue(e.y in 0f..h)
      }
    }
    assertEquals(2 * (2392f + 1072f) - 4 * (2 - Math.PI.toFloat() / 2) * 120f,
      EdgePath(2400f, 1080f, corners, ins).length, 0.1f)
  }

  @Test
  fun hugeRadiusClamped() {
    val p = EdgePath(100f, 200f, floatArrayOf(10_000f, 10_000f, 10_000f, 10_000f), zero4)
    // r clamps to 50: two 100 px straights plus a full circle of radius 50.
    assertEquals(200f + 2f * Math.PI.toFloat() * 50f, p.length, 0.1f)
    val e = EdgePoint()
    for (i in 0 until 200) {
      p.at(i / 200f, e)
      assertTrue(e.x in 0f..100f)
      assertTrue(e.y in 0f..200f)
    }
  }
}
