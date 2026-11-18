package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.BigHour
import expo.modules.haloengine.core.faces.MONO_ADVANCE
import expo.modules.haloengine.core.faces.Typewriter
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesMarginTest {
  private val colours = intArrayOf(0xFFFFFFFF.toInt(), 0xFFF472B6.toInt())

  private fun draw(face: Face, size: String, hour: Int, minute: Int, h24: Boolean, r: Pair<Float, Float>): DrawList {
    val out = DrawList()
    face.draw(FaceInput(hour, minute, 0, "Wed 18 Nov", 80, false, null, colours, 72f, 72f, r.first, r.second, FaceOptions(size = size, h24 = h24, date = false, battery = false)), out)
    return out
  }

  /** The rightmost lit x of any text box or shape. */
  private fun litRight(o: DrawList): Float {
    var r = 0f
    for (i in 0 until o.opCount) {
      if (o.kind[i] == DrawList.TEXT) {
        val x = o.points[o.start[i]]
        val w = o.text[i]!!.length * (if (o.font[i] == DrawList.MONO) MONO_ADVANCE else TEXT_ADVANCE) * o.size[i]
        r = maxOf(r, x - w * o.align[i] / 2f + w)
      } else for (k in 0 until o.count[i]) r = maxOf(r, o.points[o.start[i] + 2 * k])
    }
    return r
  }

  private fun sizeOf(o: DrawList) = (0 until o.opCount).filter { o.kind[it] == DrawList.TEXT }.maxOf { o.size[it] }

  @Test
  fun bigHourAndTypewriterKeepFiveHundredthsOfSideMargin() {
    val shapes = listOf(1008f to 2328f, 2328f to 1008f) // portrait, landscape; bounds start at 72,72
    for (face in listOf<() -> Face>({ BigHour() }, { Typewriter() })) for ((right, bottom) in shapes) for (size in listOf("s", "m", "l")) for ((h, m) in listOf(0 to 0, 9 to 41, 12 to 8, 23 to 59)) for (h24 in listOf(true, false)) {
      val o = draw(face(), size, h, m, h24, right to bottom)
      val limit = right - 0.05f * (right - 72f)
      assertTrue("${face().id} ${right.toInt()}x${bottom.toInt()} $size $h:$m h24=$h24 lit right ${litRight(o)} > $limit", litRight(o) <= limit)
    }
  }

  @Test
  fun largeIsVisiblyBiggerThanMediumInPortrait() {
    for (face in listOf<() -> Face>({ BigHour() }, { Typewriter() })) {
      val m = sizeOf(draw(face(), "m", 23, 59, true, 1008f to 2328f))
      val l = sizeOf(draw(face(), "l", 23, 59, true, 1008f to 2328f))
      assertTrue("${face().id} L $l vs M $m", l > 1.1f * m)
    }
  }
}
