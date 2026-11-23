package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.ArcProgress
import expo.modules.haloengine.core.faces.BinaryDots
import expo.modules.haloengine.core.faces.Orbit
import kotlin.math.PI
import kotlin.math.atan2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesF3Test {
  private val white = 0xFFFFFFFF.toInt()

  private fun draw(face: Face, hour: Int, minute: Int, second: Int = 0, options: FaceOptions = FaceOptions()): DrawList {
    val out = DrawList()
    face.draw(FaceInput(hour, minute, second, "Wed 18 Nov", 87, false, null, intArrayOf(white, 0xFF22D3EE.toInt()), 72f, 72f, 1008f, 2328f, options), out)
    return out
  }

  private fun dots(out: DrawList) = (0 until out.opCount).filter { out.kind[it] == DrawList.DOT }

  /** Centre of the first closed polyline (a full ring: its points average to the centre). */
  private fun ringCentre(out: DrawList): Pair<Float, Float> {
    val i = (0 until out.opCount).first { out.kind[it] == DrawList.POLYLINE && out.closed[it] }
    val n = out.count[i]
    var x = 0f; var y = 0f
    for (k in 0 until n) { x += out.points[out.start[i] + 2 * k]; y += out.points[out.start[i] + 2 * k + 1] }
    return x / n to y / n
  }

  private fun clockAngle(out: DrawList, op: Int, centre: Pair<Float, Float>): Float {
    val a = atan2(out.points[out.start[op]] - centre.first, centre.second - out.points[out.start[op] + 1])
    return if (a < 0) a + 2 * PI.toFloat() else a
  }

  @Test
  fun binaryDotsCountsFor1337() {
    val out = draw(BinaryDots(), 13, 37)
    val d = dots(out)
    assertEquals("5 hour + 6 minute dots", 11, d.size)
    val lit = d.filter { (out.color[it] ushr 24) == 0xFF }
    assertEquals("13 = 01101 (3), 37 = 100101 (3)", 6, lit.size)
    // Hours are the first five dots, minutes the next six.
    assertEquals(3, lit.count { it < d[5] })
  }

  @Test
  fun binaryDotsBitsAndSeconds() {
    assertTrue(BinaryDots.isLit(13, 5, 1)); assertTrue(BinaryDots.isLit(13, 5, 4)); assertFalse(BinaryDots.isLit(13, 5, 0))
    assertEquals(17, dots(draw(BinaryDots(), 13, 37, 59, FaceOptions(seconds = true))).size)
    assertEquals("h24 ignored", 11, dots(draw(BinaryDots(), 13, 37, 0, FaceOptions(h24 = false))).size)
  }

  @Test
  fun arcProgressSweepFollowsTheMinuteOfDay() {
    assertEquals(0f, ArcProgress.dayFraction(0, 0), 0f)
    assertEquals(0.25f, ArcProgress.dayFraction(6, 0), 1e-6f)
    assertEquals(0.75f, ArcProgress.dayFraction(18, 0), 1e-6f)
    for ((h, m) in listOf(6 to 0, 18 to 0, 9 to 30)) {
      val out = draw(ArcProgress(), h, m)
      val end = dots(out).last()
      val expected = 2 * PI.toFloat() * ArcProgress.dayFraction(h, m)
      assertEquals("$h:$m", expected, clockAngle(out, end, ringCentre(out)), 0.01f)
    }
  }

  @Test
  fun orbitDotsSitAtMinuteAndHourAngles() {
    val out = draw(Orbit(), 3, 15)
    val d = dots(out)
    val c = ringCentre(out)
    assertEquals("minute 15 = quarter turn", PI.toFloat() / 2, clockAngle(out, d[0], c), 0.01f)
    assertEquals("3:15 hour dot", 2 * PI.toFloat() * 3.25f / 12, clockAngle(out, d[1], c), 0.01f)
    assertEquals("seconds add a speck", 3, dots(draw(Orbit(), 3, 15, 30, FaceOptions(seconds = true))).size)
  }
}
