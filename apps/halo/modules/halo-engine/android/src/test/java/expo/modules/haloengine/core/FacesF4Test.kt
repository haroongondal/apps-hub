package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.DualTime
import expo.modules.haloengine.core.faces.NeonOutline
import expo.modules.haloengine.core.faces.SplitFlap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesF4Test {
  private val bare = FaceOptions(h24 = true, date = false, battery = false)

  private fun draw(face: Face, hour: Int, minute: Int, options: FaceOptions = bare): DrawList {
    val out = DrawList()
    face.draw(FaceInput(hour, minute, 0, "Wed 18 Nov", 80, false, null, intArrayOf(0xFFFFFFFF.toInt(), 0xFF22D3EE.toInt()), 72f, 72f, 1008f, 2328f, options), out)
    return out
  }

  private fun texts(out: DrawList) = (0 until out.opCount).filter { out.kind[it] == DrawList.TEXT }.map { out.text[it]!! }

  @Test
  fun dualTimeShowsUtcFromTheOffset() {
    assertEquals(listOf("13:07", "08:07 UTC"), texts(draw(DualTime { 300 }, 13, 7)))
    assertEquals(listOf("23:30", "05:00 UTC"), texts(draw(DualTime { -330 }, 23, 30)))
    assertEquals(listOf("00:10", "19:10 UTC"), texts(draw(DualTime { 300 }, 0, 10)))
    assertEquals(listOf("2:00", "9:00 UTC"), texts(draw(DualTime { 300 }, 2, 0, bare.copy(h24 = false))))
  }

  @Test
  fun splitFlapDrawsOneCardPerPair() {
    val out = draw(SplitFlap(), 9, 41)
    assertEquals(listOf("09", "41"), texts(out))
    assertEquals(2, (0 until out.opCount).count { out.kind[it] == DrawList.POLYLINE && out.closed[it] })
    assertEquals(listOf("9", "41"), texts(draw(SplitFlap(), 9, 41, bare.copy(h24 = false))))
  }

  @Test
  fun neonLightsOnlyTheSegmentsOfTheDigits() {
    val ones = draw(NeonOutline(), 11, 11)
    val eights = draw(NeonOutline(), 8, 8)
    assertTrue(texts(eights).isEmpty())
    // Three strokes per lit segment ("1" has 2, "0" has 6, "8" has 7); the colon is 2 dots x 3 layers.
    assertEquals(4 * 2 * 3 + 6, ones.opCount)
    assertEquals((6 + 7 + 6 + 7) * 3 + 6, eights.opCount) // 08:08 = 0,8,0,8
    assertTrue((0 until eights.opCount).all { eights.glow[it] == 0f })
  }
}
