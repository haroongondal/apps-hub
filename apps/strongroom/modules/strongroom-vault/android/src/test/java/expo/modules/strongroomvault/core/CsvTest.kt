package expo.modules.strongroomvault.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CsvTest {
  @Test fun quotedCommasQuotesAndNewlines() {
    assertEquals(listOf(listOf("a,b", "say \"hi\"", "line1\nline2")), Csv.parse("\"a,b\",\"say \"\"hi\"\"\",\"line1\nline2\"\n"))
  }

  @Test fun bomAndCrlf() {
    assertEquals(listOf(listOf("name", "url"), listOf("x", "y")), Csv.parse("\uFEFFname,url\r\nx,y\r\n"))
  }

  @Test fun lfAndMissingFinalNewline() {
    assertEquals(listOf(listOf("a", "b"), listOf("c", "d")), Csv.parse("a,b\nc,d"))
  }

  @Test fun emptyCellsAndTrailingComma() {
    assertEquals(listOf(listOf("a", "", "c"), listOf("", "")), Csv.parse("a,,c\n,\n"))
    assertEquals(listOf(listOf("a", "")), Csv.parse("a,"))
  }

  @Test fun blankLineIsOneEmptyCell() {
    assertEquals(listOf(listOf("a"), listOf(""), listOf("b")), Csv.parse("a\r\n\r\nb\r\n"))
  }

  @Test fun emptyInputHasNoRecords() {
    assertTrue(Csv.parse("").isEmpty())
    assertTrue(Csv.parse("\uFEFF").isEmpty())
  }

  @Test fun crlfInsideQuotesIsKept() {
    assertEquals(listOf(listOf("x\r\ny", "z")), Csv.parse("\"x\r\ny\",z\r\n"))
  }

  @Test fun strayQuotesDoNotThrow() {
    assertEquals(listOf(listOf("5\" pipe", "ab", "c")), Csv.parse("5\" pipe,\"a\"b,c"))
  }

  @Test fun unterminatedQuoteThrows() {
    for (bad in listOf("a,\"b", "\"", "a,\"b\"\"", "\"x\ny,z\n")) {
      assertThrows(bad, IllegalArgumentException::class.java) { Csv.parse(bad) }
    }
  }
}
