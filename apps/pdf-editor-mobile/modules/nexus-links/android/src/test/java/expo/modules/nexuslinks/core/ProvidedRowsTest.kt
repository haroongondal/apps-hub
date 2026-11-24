package expo.modules.nexuslinks.core

import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProvidedRowsTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private fun repoFile(path: String): File {
    val f = File("../../../../../$path")
    assertTrue("not found from ${File(".").absoluteFile}: $path", f.isFile)
    return f
  }

  private val own = File("../fixtures")
  private fun ownFixture(name: String): String {
    val f = File(own, name)
    assertTrue("not found: ${f.absolutePath}", f.isFile)
    return f.readText()
  }

  private val utc = ZoneId.of("UTC")
  private fun at(zone: ZoneId, date: String, time: String = "00:00") = LocalDate.parse(date).atTime(java.time.LocalTime.parse(time)).atZone(zone).toInstant().toEpochMilli()
  private fun file(vararg dueAt: Long, on: Boolean = true, v: Int = 1) =
    """{"v":$v,"on":$on,"items":[${dueAt.joinToString(",") { """{"title":"t$it","dueAt":$it}""" }}]}"""

  // --- the shares are bound to the fixtures ---

  @Test fun todayColumnsAuthorityPathAndCapEqualTheFixture() {
    val f = Json.parseToJsonElement(ownFixture("today.share.json")).jsonObject
    assertEquals(f.getValue("authority").jsonPrimitive.content, ProvidedRows.AUTHORITY)
    assertEquals("today", f.getValue("path").jsonPrimitive.content)
    assertEquals(f.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, ProvidedRows.TODAY_COLUMNS.toList())
    assertEquals(f.getValue("maxRows").jsonPrimitive.int, ProvidedRows.TODAY_MAX_ROWS)
  }

  @Test fun healthColumnsAndCapEqualTheContractFixture() {
    val f = Json.parseToJsonElement(repoFile("packages/app-link-contract/fixtures/app-health.share.json").readText()).jsonObject
    assertEquals("health", f.getValue("path").jsonPrimitive.content)
    assertEquals(f.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, ProvidedRows.HEALTH_COLUMNS.toList())
    assertEquals(f.getValue("maxRows").jsonPrimitive.int, ProvidedRows.HEALTH_MAX_ROWS)
  }

  @Test fun theProviderServesTheAuthorityTheContractMapsPdfEditorTo() = assertEquals("com.haroon.pdfeditor.applink", ProvidedRows.AUTHORITY)

  // --- today: the window ---

  @Test fun theWindowIsLocalMidnightInclusiveToNextMidnightExclusive() {
    val now = at(utc, "2024-06-10", "13:00")
    val start = at(utc, "2024-06-10")
    val next = at(utc, "2024-06-11")
    val rows = ProvidedRows.today(file(start - 1, start, start + 1, next - 1, next), now, utc)
    assertEquals(listOf(start, start + 1, next - 1), rows.map { it.dueAt })
  }

  @Test fun theDayIsTheDevicesNotUtc() {
    // 23:30 on 9 June in New York is already 10 June in UTC: only the New York day counts.
    val ny = ZoneId.of("America/New_York")
    val now = at(ny, "2024-06-10", "12:00")
    val lateNinth = at(ny, "2024-06-09", "23:30")
    val earlyTenth = at(ny, "2024-06-10", "00:30")
    val rows = ProvidedRows.today(file(lateNinth, earlyTenth), now, ny)
    assertEquals(listOf(earlyTenth), rows.map { it.dueAt })
  }

  @Test fun itIsWorkedOutAtQueryTimeSoTheSameFileAnswersDifferentlyTomorrow() {
    val due = at(utc, "2024-06-10", "09:00")
    val text = file(due)
    assertEquals(1, ProvidedRows.today(text, at(utc, "2024-06-10", "23:59"), utc).size)
    assertEquals(0, ProvidedRows.today(text, at(utc, "2024-06-11", "00:00"), utc).size)
    assertEquals(0, ProvidedRows.today(text, at(utc, "2024-06-09", "23:59"), utc).size)
  }

  @Test fun aSpringForwardDayIs23HoursLong() {
    val berlin = ZoneId.of("Europe/Berlin") // 31 March 2024: 02:00 jumps to 03:00
    val start = at(berlin, "2024-03-31")
    val next = at(berlin, "2024-04-01")
    assertEquals(23L * 3600_000, next - start)
    val rows = ProvidedRows.today(file(start - 1, start, next - 1, next), at(berlin, "2024-03-31", "12:00"), berlin)
    assertEquals(listOf(start, next - 1), rows.map { it.dueAt })
  }

  @Test fun aFallBackDayIs25HoursLongAndKeepsBothHoursOfTheRepeatedClock() {
    val berlin = ZoneId.of("Europe/Berlin") // 27 October 2024: 03:00 falls back to 02:00
    val start = at(berlin, "2024-10-27")
    val next = at(berlin, "2024-10-28")
    assertEquals(25L * 3600_000, next - start)
    val lateEvening = next - 1
    val rows = ProvidedRows.today(file(start - 1, start + 24 * 3600_000, lateEvening, next), at(berlin, "2024-10-27", "04:00"), berlin)
    assertEquals(listOf(start + 24 * 3600_000, lateEvening), rows.map { it.dueAt })
  }

  @Test fun aDayWhoseMidnightDoesNotExistStartsAtTheFirstInstantThatDoes() {
    val sp = ZoneId.of("America/Sao_Paulo") // 4 November 2018: 00:00 jumps to 01:00
    val start = LocalDate.parse("2018-11-04").atStartOfDay(sp).toInstant().toEpochMilli()
    val next = LocalDate.parse("2018-11-05").atStartOfDay(sp).toInstant().toEpochMilli()
    assertEquals(23L * 3600_000, next - start)
    val rows = ProvidedRows.today(file(start - 1, start, next - 1, next), start + 3600_000, sp)
    assertEquals(listOf(start, next - 1), rows.map { it.dueAt })
  }

  // --- today: ids, cap, bad rows ---

  @Test fun idsAreThePositionAmongTheServedRowsAndTitlesAreKeptAsWritten() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    val text = """{"v":1,"on":true,"items":[{"title":"other day","dueAt":${d - 86_400_000}},{"title":"  Call Dr. Khan ","dueAt":$d},{"title":"Pay rent","dueAt":${d + 1}}]}"""
    val rows = ProvidedRows.today(text, now, utc)
    assertEquals(listOf(TodayRow(1, "  Call Dr. Khan ", d), TodayRow(2, "Pay rent", d + 1)), rows)
  }

  @Test fun atMost100RowsAreServed() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    assertEquals(100, ProvidedRows.today(file(*LongArray(150) { d + it }), now, utc).size)
    val exactly = ProvidedRows.today(file(*LongArray(100) { d + it }), now, utc)
    assertEquals(100, exactly.size)
    assertEquals(100L, exactly.last().id)
    assertEquals(99, ProvidedRows.today(file(*LongArray(99) { d + it }), now, utc).size)
  }

  @Test fun theCapCountsServedRowsNotDroppedOnes() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    val junk = (1..150).joinToString(",") { """{"title":"","dueAt":$d}""" }
    val good = """{"title":"kept","dueAt":$d}"""
    val rows = ProvidedRows.today("""{"v":1,"on":true,"items":[$junk,$good]}""", now, utc)
    assertEquals(listOf(TodayRow(1, "kept", d)), rows)
  }

  @Test fun badRowsAreDroppedAndGoodOnesKept() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    val items = listOf(
      """{"title":"","dueAt":$d}""",
      """{"title":"   ","dueAt":$d}""",
      """{"title":"${"x".repeat(201)}","dueAt":$d}""",
      """{"title":"a\nb","dueAt":$d}""",
      """{"title":"a\tb","dueAt":$d}""",
      """{"title":"a\u0000b","dueAt":$d}""",
      """{"title":"a\u007fb","dueAt":$d}""",
      """{"title":7,"dueAt":$d}""",
      """{"title":null,"dueAt":$d}""",
      """{"dueAt":$d}""",
      """{"title":"no due"}""",
      """{"title":"float","dueAt":$d.5}""",
      """{"title":"exp","dueAt":1.7e12}""",
      """{"title":"whole float","dueAt":$d.0}""",
      """{"title":"string due","dueAt":"$d"}""",
      """{"title":"null due","dueAt":null}""",
      """{"title":"negative","dueAt":-1}""",
      """{"title":"too big","dueAt":9007199254740992}""",
      """{"title":"bool due","dueAt":true}""",
      "null", "5", "\"text\"", "[]", """["title"]""",
      """{"title":"ok at 200","dueAt":$d}""".replace("ok at 200", "y".repeat(200)),
      """{"title":"good","dueAt":$d}""",
    )
    val rows = ProvidedRows.today("""{"v":1,"on":true,"items":[${items.joinToString(",")}]}""", now, utc)
    assertEquals(listOf("y".repeat(200), "good"), rows.map { it.title })
    assertEquals(listOf(1L, 2L), rows.map { it.id })
  }

  @Test fun anEmojiTitleIsFine() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    assertEquals("Pay rent 🏠", ProvidedRows.today("""{"v":1,"on":true,"items":[{"title":"Pay rent 🏠","dueAt":$d}]}""", now, utc).single().title)
  }

  // --- today: whole-file refusals ---

  @Test fun theSwitchMustBeTrue() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    assertEquals(1, ProvidedRows.today(file(d), now, utc).size)
    assertEquals(0, ProvidedRows.today(file(d, on = false), now, utc).size)
    for (on in listOf("\"true\"", "1", "null", "[]", "\"\"")) assertEquals(on, 0, ProvidedRows.today("""{"v":1,"on":$on,"items":[{"title":"t","dueAt":$d}]}""", now, utc).size)
    assertEquals(0, ProvidedRows.today("""{"v":1,"items":[{"title":"t","dueAt":$d}]}""", now, utc).size)
  }

  @Test fun onlyVersionOneIsServed() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    assertEquals(0, ProvidedRows.today(file(d, v = 2), now, utc).size)
    assertEquals(0, ProvidedRows.today(file(d, v = 0), now, utc).size)
    assertEquals(0, ProvidedRows.today("""{"on":true,"items":[{"title":"t","dueAt":$d}]}""", now, utc).size)
    assertEquals(0, ProvidedRows.today("""{"v":"1","on":true,"items":[{"title":"t","dueAt":$d}]}""", now, utc).size)
    assertEquals(0, ProvidedRows.today("""{"v":1.0,"on":true,"items":[{"title":"t","dueAt":$d}]}""", now, utc).size)
  }

  @Test fun aMissingGarbledOrWronglyShapedFileServesNothing() {
    val now = at(utc, "2024-06-10", "08:00")
    for (text in listOf(null, "", "   ", "not json", "{", "[]", "null", "42", """{"v":1,"on":true}""", """{"v":1,"on":true,"items":{}}""", """{"v":1,"on":true,"items":"x"}""", "[".repeat(30000) + "]".repeat(30000))) {
      assertEquals("$text".take(20), emptyList<TodayRow>(), ProvidedRows.today(text, now, utc))
    }
  }

  @Test fun aFileOver64KbServesNothingEvenWhenItIsValid() {
    val now = at(utc, "2024-06-10", "08:00")
    val d = at(utc, "2024-06-10", "09:00")
    val head = """{"v":1,"on":true,"items":[{"title":"t","dueAt":$d}],"pad":""""
    fun padded(total: Int) = head + "x".repeat(total - head.length - 2) + "\"}"
    assertEquals(ProvidedRows.TODAY_FILE_MAX_BYTES, padded(ProvidedRows.TODAY_FILE_MAX_BYTES).length)
    assertEquals(1, ProvidedRows.today(padded(ProvidedRows.TODAY_FILE_MAX_BYTES), now, utc).size)
    assertEquals(0, ProvidedRows.today(padded(ProvidedRows.TODAY_FILE_MAX_BYTES + 1), now, utc).size)
    // 64 KB counts bytes, not characters: 40000 two-byte characters are over.
    assertEquals(0, ProvidedRows.today(head + "é".repeat(40000) + "\"}", now, utc).size)
  }

  @Test fun theSampleFileOfTheFormatIsServedOnItsDay() {
    val rows = ProvidedRows.today(ownFixture("today-file.sample.json"), 1732400000000L, utc)
    assertEquals(listOf(TodayRow(1, "Call the bank", 1732400000000L), TodayRow(2, "Renew the car insurance", 1732403600000L)), rows)
  }

  // --- reading the files never writes ---

  @Test fun readSmallReadsOnlyAndRefusesMissingBigAndNonFiles() {
    val dir = kotlin.io.path.createTempDirectory("nexus-links").toFile()
    try {
      val f = File(dir, "x")
      assertNull(ProvidedRows.readSmall(f, 10))
      f.writeText("12345")
      assertEquals("12345", ProvidedRows.readSmall(f, 5))
      assertNull(ProvidedRows.readSmall(f, 4))
      assertNull(ProvidedRows.readSmall(dir, 100))
      assertEquals(listOf("x"), dir.list()!!.toList())
      assertEquals("12345", f.readText())
      assertNull(ProvidedRows.readSmall(File(dir, "missing"), 100))
      assertEquals(listOf("x"), dir.list()!!.toList())
    } finally {
      dir.deleteRecursively()
    }
  }

  // --- health ---

  @Test fun healthIsOneRowForPdfEditorWithNoAccessibilityOrListener() {
    assertArrayEquals(arrayOf<Any?>("pdf-editor", null, null, "hub", 1764000000000L), ProvidedRows.health("hub", "1764000000000"))
    assertEquals(ProvidedRows.HEALTH_COLUMNS.size, ProvidedRows.health("hub", null).size)
  }

  @Test fun aiSourceIsOneOfHubNoneElseNone() {
    for (ok in listOf("hub", "none")) assertEquals(ok, ProvidedRows.health(ok, null)[3])
    assertEquals("hub", ProvidedRows.health("hub\n", null)[3])
    for (bad in listOf(null, "", "own", "HUB", "Hub", "groq", "hub own", "none\u0000", "gemini", "0")) assertEquals("$bad", "none", ProvidedRows.health(bad, null)[3])
  }

  @Test fun lastSeenIsDecimalEpochMsElseNull() {
    assertEquals(1764000000000L, ProvidedRows.health("none", "1764000000000")[4])
    assertEquals(1764000000000L, ProvidedRows.health("none", " 1764000000000\n")[4])
    assertEquals(9007199254740991L, ProvidedRows.health("none", "9007199254740991")[4])
    for (bad in listOf(null, "", "abc", "-5", "1.5", "1e12", "0x10", "12 34", "9007199254740992", "99999999999999999", "+5")) assertNull("$bad", ProvidedRows.health("none", bad)[4])
  }
}
