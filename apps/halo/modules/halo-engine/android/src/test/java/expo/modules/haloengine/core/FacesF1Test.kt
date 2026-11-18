package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.BigHour
import expo.modules.haloengine.core.faces.MinimalLine
import expo.modules.haloengine.core.faces.Vertical
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesF1Test {
  private val white = intArrayOf(0xFFFFFFFF.toInt(), 0xFFF472B6.toInt())

  private fun draw(face: Face, hour: Int, minute: Int, h24: Boolean = true, date: Boolean = false): DrawList {
    val out = DrawList()
    face.draw(FaceInput(hour, minute, 0, "Wed 18 Nov", 80, false, null, white, 72f, 72f, 1008f, 2328f, FaceOptions(h24 = h24, date = date, battery = false)), out)
    return out
  }

  private fun texts(out: DrawList) = (0 until out.opCount).filter { out.kind[it] == DrawList.TEXT }

  @Test
  fun minimalLineShowsTimeOverOneHairlineWithMinuteDot() {
    val out = draw(MinimalLine(), 9, 41)
    val t = texts(out).single()
    assertEquals("09:41", out.text[t])
    val lines = (0 until out.opCount).filter { out.kind[it] == DrawList.POLYLINE }
    assertEquals(1, lines.size)
    assertTrue("rule is below the digits", out.points[out.start[lines[0]] + 1] > out.points[out.start[t] + 1])
    val dots = (0 until out.opCount).filter { out.kind[it] == DrawList.DOT }
    assertEquals(1, dots.size)
    val x0 = out.points[out.start[lines[0]]]
    val x1 = out.points[out.start[lines[0]] + 2]
    val early = out.points[out.start[dots[0]]]
    val late = draw(MinimalLine(), 9, 59).let { it.points[it.start[(0 until it.opCount).first { i -> it.kind[i] == DrawList.DOT }]] }
    assertTrue("dot moves right with the minutes", early > x0 && late > early && late < x1)
  }

  @Test
  fun bigHourIsMuchLargerThanMinutesOnOneBaseline() {
    val out = draw(BigHour(), 9, 41, h24 = false)
    val (h, m) = texts(out)
    assertEquals("9", out.text[h])
    assertEquals("41", out.text[m])
    assertTrue(out.size[h] > 2.5f * out.size[m])
    assertEquals(out.points[out.start[h] + 1], out.points[out.start[m] + 1], 0.01f)
    assertTrue("minutes sit right of the hour", out.points[out.start[m]] > out.points[out.start[h]])
  }

  @Test
  fun verticalStacksOneDigitPerRowTopToBottom() {
    val out = draw(Vertical(), 13, 7)
    val rows = texts(out)
    assertEquals(listOf("1", "3", "0", "7"), rows.map { out.text[it] })
    val ys = rows.map { out.points[out.start[it] + 1] }
    assertEquals(ys, ys.sorted())
    assertEquals(1, rows.map { out.points[out.start[it]] }.toSet().size)
    assertEquals(listOf("1", "0", "7"), draw(Vertical(), 13, 7, h24 = false).let { o -> texts(o).map { o.text[it] } })
    assertEquals(1, (0 until out.opCount).count { out.kind[it] == DrawList.POLYLINE })
  }
}
