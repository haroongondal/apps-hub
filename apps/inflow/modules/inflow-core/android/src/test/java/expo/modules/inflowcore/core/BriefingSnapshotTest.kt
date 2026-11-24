package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.SiblingPackages
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BriefingSnapshotTest {
  private fun l(id: Long, kind: String, text: String, at: Long? = null, personal: Int = 0) = BriefingLine(id, kind, text, at, personal)
  private val bill = l(1_000_000_000_007, "bill", "Bill due 25 Nov", 1_764_028_800_000)
  private val spent = l(3_000_000_000_000, "spent", "Spent PKR 4,200 yesterday", null, 1)
  private val medicine = l(4_000_000_000_000, "medicine", "Medicine at 14:00", 1_763_974_800_000, 1)
  private val steps = l(5_000_000_000_000, "steps", "6214 steps", null, 1)
  private val snapshot = BriefingSnapshot(1_763_960_000_000, listOf(bill, spent, medicine, steps))

  @Test fun aSnapshotSurvivesTheRoundTripExactly() = assertEquals(snapshot, BriefingSnapshot.parse(snapshot.toJson()))

  @Test fun anEmptyBriefingRoundTripsAsBuiltNotAsMissing() {
    val s = BriefingSnapshot(5, emptyList())
    assertEquals(s, BriefingSnapshot.parse(s.toJson()))
  }

  @Test fun unreadableJsonReadsAsEmpty() {
    for (bad in listOf(null, "", "{", "[]", "null", "{}", """{"builtAt":"1","lines":[]}""", """{"builtAt":1}""", """{"builtAt":1,"lines":{}}""", """{"builtAt":1.5,"lines":[]}"""))
      assertEquals(bad, BriefingSnapshot.EMPTY, BriefingSnapshot.parse(bad))
    assertTrue(BriefingSnapshot.EMPTY.lines.isEmpty())
    assertTrue(BriefingSnapshot.EMPTY.stale(System.currentTimeMillis()))
  }

  @Test fun aLineThatDoesNotValidateIsDroppedAndTheRestStay() {
    fun line(id: String = "1", kind: String = "bill", text: String = "Bill due 25 Nov", at: String = "null", personal: String = "0") =
      """{"id":$id,"kind":"$kind","text":"$text","at":$at,"personal":$personal}"""
    val json = """{"builtAt":9,"lines":[${listOf(
      line(),
      line(kind = "secret"),                    // unknown kind
      line(personal = "2"),                     // not 0 or 1
      line(text = "x".repeat(61)),              // over the cap
      line(text = "tab\\there"),                // a control character
      line(text = " "),                         // blank
      line(id = "\"1\""),                       // id not a number
      line(at = "\"soon\""),                    // at neither null nor a number
      line(personal = "true"),
      """{"id":1,"kind":"bill","text":"Bill due 25 Nov","personal":0}""",   // no at
      "7", "null",
    ).joinToString(",")}]}"""
    assertEquals(listOf(l(1, "bill", "Bill due 25 Nov")), BriefingSnapshot.parse(json).lines)
  }

  @Test fun atMost20LinesAreKept() {
    val many = BriefingSnapshot(1, (1..25L).map { l(it, "tasks", "$it tasks") })
    assertEquals(20, BriefingSnapshot.parse(many.toJson()).lines.size)
    assertEquals(20, BriefingSnapshot.parse(BriefingSnapshot(1, many.lines).toJson()).lines.size)
  }

  @Test fun itIsStaleAfterTenMinutesAndWhenTheClockWentBack() {
    val s = BriefingSnapshot(1_000_000, emptyList())
    assertFalse(s.stale(1_000_000 + 10 * 60_000))
    assertTrue(s.stale(1_000_000 + 10 * 60_000 + 1))
    assertTrue(s.stale(999_999))
  }

  @Test fun onlyAUidHoldingHaloAloneIsHalo() {
    assertEquals("com.haroon.halo", SiblingPackages.HALO)
    assertTrue(BriefingShare.callerIsHalo(arrayOf(SiblingPackages.HALO)))
    for (other in listOf(null, emptyArray(), arrayOf(SiblingPackages.NEXUS), arrayOf(SiblingPackages.DEPUTY), arrayOf(SiblingPackages.INFLOW), arrayOf(SiblingPackages.HALO, SiblingPackages.NEXUS), arrayOf(SiblingPackages.DEPUTY, SiblingPackages.HALO), arrayOf("com.haroon.halo.debug"), arrayOf(""))) {
      assertFalse(other?.toList().toString(), BriefingShare.callerIsHalo(other))
    }
  }

  @Test fun sharingOffServesNothingWhateverTheSnapshotHolds() {
    assertEquals(0, BriefingShare.serve(false, true, snapshot).size)
    assertEquals(0, BriefingShare.serve(false, false, snapshot).size)
  }

  @Test fun sharingOnServesTheLinesAsFiveColumnRows() {
    val rows = BriefingShare.serve(true, true, snapshot)
    assertEquals(4, rows.size)
    assertArrayEquals(arrayOf<Any?>(1_000_000_000_007, "bill", "Bill due 25 Nov", 1_764_028_800_000, 0), rows[0])
    assertTrue(rows.all { it.size == BriefingShare.COLUMNS.size })
    assertNull(rows[1][3])
  }

  @Test fun healthKindsAreNeverServedWhileTheHealthSettingIsOffEvenWhenTheSnapshotHoldsThem() {
    val rows = BriefingShare.serve(true, false, snapshot)
    assertEquals(listOf("bill", "spent"), rows.map { it[1] })
    assertEquals(listOf("bill", "spent", "medicine", "steps"), BriefingShare.serve(true, true, snapshot).map { it[1] })
  }

  @Test fun aRowIsRevalidatedWhenItIsBuilt() {
    assertNull(BriefingShare.row(l(1, "bill", "x", personal = 2)))
    assertNull(BriefingShare.row(l(1, "nope", "x")))
    assertNull(BriefingShare.row(l(1, "bill", " \u0007 ")))
    val row = BriefingShare.row(l(1, "bill", "a\u0007b\n" + "c".repeat(100)))!!
    assertEquals(60, (row[2] as String).length)
    assertFalse((row[2] as String).any { it.isISOControl() })
    // a kind that is personal by nature is served personal even when its line says 0
    assertEquals(1, BriefingShare.row(l(1, "home", "Ali is home", personal = 0))!![4])
    assertEquals(0, BriefingShare.row(l(1, "cards", "1 card expires this month", personal = 0))!![4])
  }

  @Test fun theSnapshotCodeServesNothingBeyondTheRowCap() {
    val s = BriefingSnapshot(1, (1..30L).map { l(it, "tasks", "$it tasks") })
    assertEquals(20, BriefingShare.serve(true, true, s).size)
  }

  // The fixture the TS share test pins: the columns, and every sample row going through the row builder unchanged.
  private val root = File("../../../../../packages/autopilot-contract/fixtures")

  @Test fun theColumnsAndTheCapEqualTheShareFixture() {
    val share = Json.parseToJsonElement(File(root, "briefing.share.json").readText()).jsonObject
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, BriefingShare.COLUMNS.toList())
    assertEquals(share.getValue("path").jsonPrimitive.content, BriefingShare.PATH)
    assertEquals(share.getValue("maxRows").jsonPrimitive.long.toInt(), BriefingShare.MAX_ROWS)
  }

  @Test fun everySampleRowOfTheFixtureComesOutOfTheRowBuilderUnchanged() {
    val rows = Json.parseToJsonElement(File(root, "briefing-rows.sample.json").readText()).jsonArray.map { it.jsonObject }
    assertTrue(rows.any { it.getValue("kind").jsonPrimitive.content == "medicine" } && rows.any { it.getValue("at").jsonPrimitive.longOrNull == null })
    val served = BriefingShare.serve(true, true, BriefingSnapshot(1, rows.map {
      l(it.getValue("line_id").jsonPrimitive.long, it.getValue("kind").jsonPrimitive.content, it.getValue("text").jsonPrimitive.content, it.getValue("at").jsonPrimitive.longOrNull, it.getValue("personal").jsonPrimitive.long.toInt())
    }))
    assertEquals(rows.size, served.size)
    rows.forEachIndexed { i, o ->
      assertArrayEquals(BriefingShare.COLUMNS.map { c -> o.getValue(c).jsonPrimitive.let { p -> if (p.isString) p.content else p.longOrNull?.let { n -> if (c == "personal") n.toInt() else n } } }.toTypedArray(), served[i])
    }
  }
}
