package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesTest {
  // View size -> face bounds (the view inset the way FaceView insets it).
  private val screens = listOf(1080f to 2400f, 2400f to 1080f)
  private val times = listOf(Triple(0, 0, 0), Triple(9, 41, 7), Triple(13, 7, 59), Triple(23, 59, 30))
  private val colourSets = listOf(intArrayOf(0xFFFFFFFF.toInt()), intArrayOf(0xFF22D3EE.toInt(), 0xFFF472B6.toInt(), 0xFFA78BFA.toInt(), 0xFF34D399.toInt()))

  private fun extras(o: FaceOptions) = listOf(
    o,
    o.copy(alarm = true, seconds = true),
    o.copy(date = false, battery = false, alarm = false),
  )

  @Test
  fun everyFaceDrawsFiniteOpsInBounds() {
    val out = DrawList()
    for (factory in Faces.all) {
      val face = factory()
      for ((w, h) in screens) for (size in listOf("s", "m", "l")) for (position in listOf("top", "centre", "bottom"))
        for (h24 in listOf(true, false)) for (options in extras(FaceOptions(size = size, position = position, h24 = h24)))
          for ((hour, minute, second) in times) for (colours in colourSets) {
            val input = FaceInput(hour, minute, second, "Wed 18 Nov", 87, hour % 2 == 0, "07:30", colours,
              72f, 72f, w - 72f, h - 72f, options)
            out.clear()
            face.draw(input, out)
            val where = "${face.id} ${w.toInt()}x${h.toInt()} $options $hour:$minute:$second"
            assertTrue("$where draws", out.opCount > 0)
            var texts = 0
            for (i in 0 until out.opCount) {
              val size = out.size[i]
              assertTrue("$where op $i size $size", size.isFinite() && size >= 0f)
              assertTrue("$where op $i glow", out.glow[i].isFinite() && out.glow[i] >= 0f)
              for (k in 0 until out.count[i]) {
                val x = out.points[out.start[i] + 2 * k]
                val y = out.points[out.start[i] + 2 * k + 1]
                assertTrue("$where op $i point ($x, $y)", x.isFinite() && y.isFinite())
                when (out.kind[i]) {
                  DrawList.DOT -> assertBox(where, i, x - size, y - size, x + size, y + size, input)
                  DrawList.TEXT -> {
                    texts++
                    val text = out.text[i]!!
                    assertTrue("$where op $i empty text", text.isNotEmpty())
                    val tw = text.length * TEXT_ADVANCE * size
                    val left = x - tw * out.align[i] / 2f
                    assertBox("$where '$text'", i, left, y - TEXT_ASCENT * size, left + tw, y + TEXT_DESCENT * size, input)
                  }
                  else -> assertBox(where, i, x, y, x, y, input)
                }
              }
            }
            if (options.date) assertTrue("$where has text", texts > 0)
          }
    }
  }

  private fun assertBox(where: String, i: Int, l: Float, t: Float, r: Float, b: Float, input: FaceInput) {
    val e = 0.5f
    assertTrue("$where op $i box ($l, $t, $r, $b) outside (${input.left}, ${input.top}, ${input.right}, ${input.bottom})",
      l >= input.left - e && t >= input.top - e && r <= input.right + e && b <= input.bottom + e)
  }

  @Test
  fun registry() {
    val ids = Faces.all.map { it().id }
    assertEquals("ids unique", ids.size, ids.toSet().size)
    assertTrue(ids.containsAll(listOf("big-digits", "ring-analog", "stacked")))
    ids.forEach { assertTrue("id format $it", Regex("^[a-z0-9-]{1,40}$").matches(it)) }
    Faces.all.forEach { assertTrue("name of ${it().id}", it().name.isNotBlank()) }
    assertEquals("big-digits", Faces.create("no-such-face").id)
    assertEquals("stacked", Faces.create("stacked").id)
    assertNotSame(Faces.create("ring-analog"), Faces.create("ring-analog"))
  }

  @Test
  fun timeText() {
    assertEquals("07:05", timeText(7, 5, true))
    assertEquals("00:00", timeText(0, 0, true))
    assertEquals("12:05", timeText(0, 5, false))
    assertEquals("1:05", timeText(13, 5, false))
    assertEquals("12:59", timeText(12, 59, false))
  }
}
