package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PdfLayoutTest {
  private val mono: (String) -> Float = { it.codePointCount(0, it.length) * 6f }   // 6 points a character

  @Test fun wrapsAtSpacesAndKeepsBlankLines() {
    assertEquals(
      listOf("Sleep was", "short on", "three", "nights.", "", "Steps rose."),
      PdfLayout.wrap("Sleep was short on three nights.\n\nSteps rose.", 66f, mono),
    )
  }

  @Test fun aWordWiderThanTheLineIsBrokenNeverInsideASurrogatePair() {
    assertEquals(listOf("abcde", "fghij", "k ok"), PdfLayout.wrap("abcdefghijk ok", 30f, mono))
    val lines = PdfLayout.wrap("😀".repeat(7), 18f, mono)
    assertEquals(listOf(3, 3, 1), lines.map { it.codePointCount(0, it.length) })
    assertTrue(lines.none { Character.isHighSurrogate(it.last()) })
  }

  @Test fun everyLineFitsAndNoWordIsLost() {
    val text = "The owner logged mood and sleep most days.\r\nMedicine doses were mostly taken.\tOne dose was missed on Monday."
    val lines = PdfLayout.wrap(text, 72f, mono)
    assertTrue(lines.all { mono(it) <= 72f })
    assertEquals(text.split(Regex("\\s+")), lines.flatMap { it.split(' ') }.filter(String::isNotEmpty))
  }

  @Test fun pagesHoldFewerLinesOnTheFirstPage() {
    val lines = (1..10).map { "l$it" }
    assertEquals(listOf(listOf("l1", "l2"), listOf("l3", "l4", "l5", "l6"), listOf("l7", "l8", "l9", "l10")), PdfLayout.pages(lines, 2, 4))
    assertEquals(listOf(emptyList<String>()), PdfLayout.pages(emptyList(), 2, 4))
    assertEquals(1, PdfLayout.pages(lines, 10, 4).size)
  }
}
