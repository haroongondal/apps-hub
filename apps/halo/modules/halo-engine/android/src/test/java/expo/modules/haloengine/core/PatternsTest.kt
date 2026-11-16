package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

class PatternsTest {
  private val screens = listOf(1080f to 2400f, 2400f to 1080f)
  private val variants = listOf(
    PatternParams(),
    PatternParams(thicknessPx = 66f, speed = 1f, spread = 1f, glow = 1f, paddingPx = 88f, mirrored = true, clockwise = false),
    PatternParams(thicknessPx = 3f, speed = 0f, spread = 0f, glow = 0f, mirrored = true),
  )
  private val colors = intArrayOf(0xFF22D3EE.toInt(), 0xFFA78BFA.toInt(), 0xFFF472B6.toInt())

  private class Frame(val bands: FloatArray, val level: Float, val beat: Boolean)

  /** Seeded random spectra with a per-frame loudness so levels range from near-silent to full. */
  private fun spectra(seed: Long, n: Int): List<Frame> {
    val r = Random(seed)
    return List(n) {
      val loud = r.nextFloat()
      val bands = FloatArray(32) { r.nextFloat() * loud }
      Frame(bands, bands.average().toFloat(), r.nextInt(8) == 0)
    }
  }

  private fun silence(n: Int) = List(n) { Frame(FloatArray(32), 0f, false) }

  private fun path(w: Float, h: Float) = EdgePath(w, h, floatArrayOf(120f, 120f, 120f, 120f), FloatArray(4))

  private fun drive(patterns: List<Pattern>, path: EdgePath, params: PatternParams, frames: List<Frame>,
                    check: (Int, List<DrawList>) -> Unit) {
    val outs = patterns.map { DrawList() }
    val spectrum = SpectrumFrame(FloatArray(32), 0f, false)
    frames.forEachIndexed { i, f ->
      f.bands.copyInto(spectrum.bands)
      spectrum.level = f.level
      spectrum.beat = f.beat
      val input = FrameInput(path, spectrum, 1_000_000L + i * 16L, 16L, params, colors)
      patterns.forEachIndexed { k, p -> outs[k].clear(); p.draw(input, outs[k]) }
      check(i, outs)
    }
  }

  @Test
  fun opsStayOnScreenAndBounded() {
    val maxOps = HashMap<String, Int>()
    for (factory in Patterns.all) for ((w, h) in screens) for (params in variants) {
      val id = factory().id
      drive(listOf(factory()), path(w, h), params, spectra(7, 300)) { frame, (out) ->
        val where = "$id ${w}x$h mirrored=${params.mirrored} frame $frame"
        assertTrue("$where opCount ${out.opCount}", out.opCount <= 4096)
        if (params === variants[0]) maxOps[id] = maxOf(maxOps[id] ?: 0, out.opCount)
        for (i in 0 until out.opCount) {
          val glow = out.glow[i]
          assertTrue("$where op $i glow $glow", glow.isFinite() && glow >= 0f)
          assertTrue("$where op $i size", out.size[i].isFinite() && out.size[i] >= 0f)
          assertTrue("$where op $i count", out.count[i] >= 1)
          for (k in 0 until out.count[i]) {
            val x = out.points[out.start[i] + 2 * k]
            val y = out.points[out.start[i] + 2 * k + 1]
            assertTrue("$where op $i point ($x, $y)", x.isFinite() && y.isFinite())
            assertTrue("$where op $i x $x", x >= -glow && x <= w + glow)
            assertTrue("$where op $i y $y", y >= -glow && y <= h + glow)
          }
        }
      }
    }
    println("Max ops per frame at default params: $maxOps")
  }

  @Test
  fun sameSeedSameOps() {
    for (factory in Patterns.all) for (params in variants) {
      val a = factory()
      drive(listOf(a, factory()), path(1080f, 2400f), params, spectra(11, 300)) { frame, (x, y) ->
        val where = "${a.id} frame $frame"
        assertEquals(where, x.opCount, y.opCount)
        for (i in 0 until x.opCount) {
          assertEquals(where, x.kind[i], y.kind[i])
          assertEquals(where, x.color[i], y.color[i])
          assertEquals(where, x.size[i], y.size[i], 0f)
          assertEquals(where, x.glow[i], y.glow[i], 0f)
          assertEquals(where, x.closed[i], y.closed[i])
          assertEquals(where, x.count[i], y.count[i])
          for (k in 0 until 2 * x.count[i]) assertEquals(where, x.points[x.start[i] + k], y.points[y.start[i] + k], 0f)
        }
      }
    }
  }

  @Test
  fun silenceDrawsNothing() {
    for (factory in Patterns.all) {
      val id = factory().id
      drive(listOf(factory()), path(1080f, 2400f), PatternParams(), silence(60)) { frame, (out) ->
        assertEquals("$id silent frame $frame", 0, out.opCount)
      }
      // After music, about 3 s of silence (at the slowest speed) fades everything out.
      var last = -1
      drive(listOf(factory()), path(1080f, 2400f), PatternParams(speed = 0f), spectra(3, 300) + silence(200)) { _, (out) -> last = out.opCount }
      assertEquals("$id after silence", 0, last)
    }
  }

  @Test
  fun registry() {
    val ids = Patterns.all.map { it().id }
    assertEquals("ids unique", ids.size, ids.toSet().size)
    assertTrue(ids.containsAll(listOf("pulse-ring", "corner-bloom", "spectrum-rim", "comet", "ember-drift", "ripple")))
    assertEquals(Family.values().toSet(), Patterns.all.map { it().family }.toSet())
    assertEquals("pulse-ring", Patterns.create("no-such-pattern").id)
    assertEquals("comet", Patterns.create("comet").id)
    assertNotSame(Patterns.create("ember-drift"), Patterns.create("ember-drift"))
  }

  @Test
  fun drawListMirrorsAboutAxis() {
    val out = DrawList()
    out.polyline(floatArrayOf(10f, 1f, 30f, 2f), 2, 5, 3f, 4f, false)
    out.dot(40f, 7f, 2f, 6, 1f)
    out.mirrorX(0, 50f)
    assertEquals(4, out.opCount)
    assertEquals(90f, out.points[out.start[2]], 0f)
    assertEquals(70f, out.points[out.start[2] + 2], 0f)
    assertEquals(2f, out.points[out.start[2] + 3], 0f)
    assertEquals(60f, out.points[out.start[3]], 0f)
    assertEquals(DrawList.DOT, out.kind[3])
    out.clear()
    assertEquals(0, out.opCount)
  }
}
