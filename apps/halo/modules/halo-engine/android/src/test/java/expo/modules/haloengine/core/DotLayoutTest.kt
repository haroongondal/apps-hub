package expo.modules.haloengine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DotLayoutTest {
  private val m = DotMetrics(dot = 12f, gap = 10f, labelGap = 3f, lineGap = 8f)
  private val textW: (String) -> Float = { it.length * 7f }

  private fun row(vararg counts: Pair<DotKind, Int>, overflow: Int = 0) = DotRow(counts.map { Dot(it.first, it.second) }, overflow)

  @Test
  fun labelsOnlyForTwoOrMoreWithCountsOn() {
    assertNull(DotLayout.label(1, counts = true))
    assertEquals("2", DotLayout.label(2, counts = true))
    assertEquals("9", DotLayout.label(9, counts = true))
    assertEquals("9+", DotLayout.label(10, counts = true))
    assertNull(DotLayout.label(5, counts = false))
  }

  @Test
  fun oneLineIsRightAlignedInOrder() {
    val cells = DotLayout.place(row(DotKind.CHARGING to 1, DotKind.WHATSAPP to 1, DotKind.OTHER to 1), true, right = 300f, top = 50f, m = m, textW = textW)
    assertEquals(listOf(DotKind.CHARGING, DotKind.WHATSAPP, DotKind.OTHER), cells.map { it.dot?.kind })
    // 3 dots of 12 and 2 gaps of 10 = 56 wide, ending at 300.
    assertEquals(listOf(244f, 266f, 288f), cells.map { it.x })
    assertTrue(cells.all { it.y == 50f && it.label == null })
  }

  @Test
  fun countWidensItsCell() {
    val cells = DotLayout.place(row(DotKind.WHATSAPP to 3, DotKind.OTHER to 1), true, 300f, 0f, m, textW)
    assertEquals("3", cells[0].label)
    assertEquals(12f + 3f + 7f, cells[0].w)
    assertEquals(300f, cells.last().x + cells.last().w)
    assertEquals(cells[0].x + cells[0].w + 10f, cells[1].x)
  }

  @Test
  fun wrapsAfterFourAndPutsOverflowLast() {
    val kinds = DotKind.entries.take(8).map { it to 1 }.toTypedArray()
    val cells = DotLayout.place(row(*kinds, overflow = 2), false, 300f, 10f, m, textW)
    assertEquals(9, cells.size)
    assertEquals(List(4) { 10f } + List(5) { 30f }, cells.map { it.y })
    val last = cells.last()
    assertNull(last.dot)
    assertEquals("+2", last.label)
    assertEquals(300f, last.x + last.w)
    assertEquals(300f, cells[3].x + cells[3].w)
  }

  @Test
  fun emptyRowPlacesNothing() {
    assertTrue(DotLayout.place(DotRow(emptyList(), 0), true, 300f, 0f, m, textW).isEmpty())
    assertEquals(listOf("+3"), DotLayout.place(DotRow(emptyList(), 3), true, 300f, 0f, m, textW).map { it.label })
  }

  @Test
  fun freshIsNewDotsAndRisingCounts() {
    val a = row(DotKind.WHATSAPP to 2, DotKind.OTHER to 1)
    assertEquals(emptySet<DotKind>(), DotLayout.fresh(null, a))
    assertEquals(emptySet<DotKind>(), DotLayout.fresh(a, a))
    assertEquals(setOf(DotKind.WHATSAPP), DotLayout.fresh(a, row(DotKind.WHATSAPP to 3, DotKind.OTHER to 1)))
    assertEquals(setOf(DotKind.CHARGING), DotLayout.fresh(a, row(DotKind.CHARGING to 1, DotKind.WHATSAPP to 2)))
    // A dismissed notification lowers a count and must not ripple.
    assertEquals(emptySet<DotKind>(), DotLayout.fresh(a, row(DotKind.WHATSAPP to 1)))
  }
}
