package expo.modules.haloengine.core

import expo.modules.haloengine.core.faces.CalendarStrip
import expo.modules.haloengine.core.faces.MONO_ADVANCE
import expo.modules.haloengine.core.faces.Typewriter
import expo.modules.haloengine.core.faces.WordClock
import expo.modules.haloengine.core.faces.weekdayIndex
import expo.modules.haloengine.core.faces.wordTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FacesF2Test {
  private fun input(hour: Int, minute: Int, date: String = "Wed 18 Nov", options: FaceOptions = FaceOptions()) =
    FaceInput(hour, minute, 0, date, 80, false, null, intArrayOf(0xFFFFFFFF.toInt(), 0xFFF472B6.toInt()), 0f, 0f, 1000f, 2000f, options)

  private fun texts(face: Face, input: FaceInput): List<Int> {
    val out = DrawList()
    face.draw(input, out)
    return (0 until out.opCount).filter { out.kind[it] == DrawList.TEXT }.also { last = out }
  }

  private var last = DrawList()

  @Test
  fun wordPhrases() {
    assertEquals("three o'clock", wordTime(3, 0))
    assertEquals("five past three", wordTime(3, 5))
    assertEquals("quarter past three", wordTime(3, 15))
    assertEquals("half past three", wordTime(3, 30))
    assertEquals("quarter to four", wordTime(3, 45))
    assertEquals("five to four", wordTime(3, 59))
    assertEquals("twelve o'clock", wordTime(12, 0))
    assertEquals("twelve o'clock", wordTime(0, 0))
    assertEquals("twenty-five to one", wordTime(0, 35))
    assertEquals("quarter to twelve", wordTime(23, 45))
    assertEquals("quarter to twelve", wordTime(11, 45))
    assertEquals("twelve o'clock", wordTime(12, 4))
  }

  @Test
  fun wordClockDrawsThePhraseOnItsLines() {
    val ids = texts(WordClock(), input(14, 15, options = FaceOptions(date = false, battery = false)))
    assertEquals(listOf("quarter past", "two"), ids.map { last.text[it] })
    val oclock = texts(WordClock(), input(14, 0, options = FaceOptions(date = false, battery = false)))
    assertEquals(listOf("two", "o'clock"), oclock.map { last.text[it] })
  }

  @Test
  fun weekday() {
    assertEquals(0, weekdayIndex("Mon 16 Nov"))
    assertEquals(2, weekdayIndex("Wed 18 Nov"))
    assertEquals(6, weekdayIndex("18 Nov, Sun"))
    assertTrue(weekdayIndex("????") in 0..6)
  }

  @Test
  fun stripHighlightsToday() {
    for ((date, day) in listOf("Mon 16 Nov" to 0, "Wed 18 Nov" to 2, "Sun 22 Nov" to 6)) {
      val face = CalendarStrip()
      val inp = input(9, 41, date)
      texts(face, inp)
      val letters = (0 until last.opCount).filter { last.kind[it] == DrawList.TEXT && last.text[it]!!.length == 1 }
      assertEquals(7, letters.size)
      val bold = letters.filter { last.font[it] == DrawList.BOLD }
      assertEquals(1, bold.size)
      assertEquals("accent colour", inp.accent, last.color[bold[0]])
      val xs = letters.map { last.points[last.start[it]] }
      assertEquals(xs.sorted(), xs)
      assertEquals(xs[day], last.points[last.start[bold[0]]], 0.01f)
    }
  }

  @Test
  fun typewriterCursorFollowsTheText() {
    val opts = FaceOptions(date = false, battery = false)
    for ((h24, shown) in listOf(true to "09:41", false to "9:41")) {
      val inp = input(9, 41, options = opts.copy(h24 = h24))
      val ids = texts(Typewriter(), inp)
      val time = ids.single { last.text[it] == shown }
      assertEquals(DrawList.MONO, last.font[time])
      val size = last.size[time]
      val end = last.points[last.start[time]] + shown.length * MONO_ADVANCE * size
      val poly = (0 until last.opCount).filter { last.kind[it] == DrawList.POLYLINE }
      assertTrue(poly.isNotEmpty())
      for (p in poly) assertTrue("cursor right of text", last.points[last.start[p]] >= end)
    }
  }
}
