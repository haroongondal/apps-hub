package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class EdgeEventsTest {
  private val w = 1080f
  private val h = 2400f
  private val path = EdgePath(w, h, floatArrayOf(120f, 120f, 120f, 120f), FloatArray(4))
  private val params = PatternParams()
  private val red = 0xFFFF0000.toInt()
  private val blue = 0xFF0000FF.toInt()

  private fun decision(pkg: String, style: String = "pulse", repeat: Int = 2, durationMs: Long = 1500) =
    FlashDecision(pkg, null, style, repeat, durationMs)

  private fun frame(events: EdgeEvents, nowMs: Long, p: EdgePath = path, pp: PatternParams = params): DrawList =
    DrawList().also { events.draw(p, pp, nowMs, it) }

  private fun rgbs(out: DrawList): Set<Int> = (0 until out.opCount).map { out.color[it] and 0xFFFFFF }.toSet()

  @Test
  fun pulseDrawsThenEnds() {
    val e = EdgeEvents()
    assertFalse(e.active(0))
    e.flash(decision("a"), red, 1_000)
    assertTrue(e.active(1_000))
    // repeat 2 over 1500 ms: the first peak is at 375 ms.
    assertTrue(frame(e, 1_375).opCount > 0)
    assertTrue(e.active(2_499))
    assertFalse(e.active(2_500))
    assertEquals(0, frame(e, 2_500).opCount)
    assertEquals(0, frame(e, 9_000).opCount)
  }

  @Test
  fun pulseRepeatsBrightness() {
    val e = EdgeEvents()
    e.flash(decision("a", repeat = 3, durationMs = 3000), red, 0)
    fun alpha(t: Long) = frame(e, t).let { o -> (0 until o.opCount).maxOfOrNull { o.color[it] ushr 24 } ?: 0 }
    for (peak in longArrayOf(500, 1500, 2500)) assertTrue("peak $peak", alpha(peak) > 200)
    for (dip in longArrayOf(1000, 2000)) assertTrue("dip $dip", alpha(dip) < 20)
  }

  @Test
  fun sweepCoversRim() {
    val e = EdgeEvents()
    e.flash(decision("a", style = "sweep", repeat = 1, durationMs = 2000), red, 0)
    val pts = ArrayList<Pair<Float, Float>>()
    for (t in 0L until 2000L step 16) {
      val o = frame(e, t)
      for (i in 0 until o.opCount) for (k in 0 until o.count[i]) {
        pts.add(o.points[o.start[i] + 2 * k] to o.points[o.start[i] + 2 * k + 1])
      }
    }
    val p = EdgePoint()
    for (s in 0 until 100) {
      path.at(s / 100f, p)
      val near = pts.minOf { hypot(it.first - p.x, it.second - p.y) }
      assertTrue("rim sample $s nearest $near px", near < 40f)
    }
    assertEquals(0, frame(e, 2000).opCount)
  }

  @Test
  fun samePkgReplaces() {
    val e = EdgeEvents()
    e.flash(decision("a"), red, 0)
    e.flash(decision("a"), blue, 1_000)
    assertEquals(setOf(0x0000FF), rgbs(frame(e, 1_375)))
    // The new post restarts the flash: it runs a full duration from 1000 ms.
    assertTrue(e.active(2_400))
    assertFalse(e.active(2_500))
  }

  @Test
  fun queueIsBounded() {
    val e = EdgeEvents()
    for (i in 0 until 20) e.flash(decision("pkg$i"), 0xFF000000.toInt() or (i + 1), i.toLong())
    val seen = rgbs(frame(e, 400))
    assertEquals(8, seen.size)
    assertEquals((13..20).toSet(), seen)
  }

  @Test
  fun opsInBounds() {
    val styles = listOf("pulse", "sweep", "comet", "pulse-ring", "rain", "no-such-pattern")
    val screens = listOf(EdgePath(w, h, floatArrayOf(120f, 120f, 120f, 120f), FloatArray(4)),
      EdgePath(h, w, FloatArray(4), floatArrayOf(10f, 20f, 30f, 40f)))
    val variants = listOf(params, PatternParams(thicknessPx = 66f, glow = 1f, paddingPx = 88f, mirrored = true, clockwise = false))
    for ((si, p) in screens.withIndex()) for (pp in variants) for (style in styles) {
      val e = EdgeEvents()
      e.flash(decision("a", style = style, repeat = 3, durationMs = 1200), red, 0)
      e.flash(decision("b", style = "sweep"), blue, 100)
      val sw = if (si == 0) w else h
      val sh = if (si == 0) h else w
      var drew = false
      for (t in 0L..1700L step 16) {
        val o = frame(e, t, p, pp)
        if (o.opCount > 0) drew = true
        assertTrue("$style ops ${o.opCount}", o.opCount <= 4096)
        for (i in 0 until o.opCount) {
          val g = o.glow[i]
          assertTrue(g.isFinite() && g >= 0f && o.size[i].isFinite() && o.size[i] >= 0f)
          for (k in 0 until o.count[i]) {
            val x = o.points[o.start[i] + 2 * k]
            val y = o.points[o.start[i] + 2 * k + 1]
            assertTrue("$style t=$t ($x, $y)", x >= -g && x <= sw + g && y >= -g && y <= sh + g)
          }
        }
      }
      assertTrue("$style drew", drew)
      assertFalse(e.active(1_700))
    }
  }
}
