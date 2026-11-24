package expo.modules.nexuslinks.core

import java.io.File
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadersTest {
  private val asks = Readers.SPECS.getValue("inflow.ask_items")
  private val runs = Readers.SPECS.getValue("deputy.runs")

  private fun type(s: String) = when (s) {
    "long" -> Readers.Type.LONG
    "int" -> Readers.Type.INT
    "double" -> Readers.Type.DOUBLE
    "string" -> Readers.Type.STRING
    "long?" -> Readers.Type.LONG_N
    "int?" -> Readers.Type.INT_N
    "double?" -> Readers.Type.DOUBLE_N
    "string?" -> Readers.Type.STRING_N
    else -> throw AssertionError("unknown type $s")
  }

  // fixtures/reader-shares.json is generated from src/shares.ts (shares.test.ts asserts it equal), so TypeScript and Kotlin agree.
  @Test fun everySpecEqualsTheSharedFixture() {
    val f = File("../fixtures/reader-shares.json")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    val fixture = Json.parseToJsonElement(f.readText()).jsonObject
    assertEquals(fixture.keys.toList(), Readers.SPECS.keys.toList())
    for ((id, e) in fixture) {
      val o = e.jsonObject
      val spec = Readers.SPECS.getValue(id)
      assertEquals(id, o.getValue("authority").jsonPrimitive.content, spec.authority)
      assertEquals(id, o.getValue("path").jsonPrimitive.content, spec.path)
      assertEquals(id, o.getValue("columns").jsonArray.map { c -> c.jsonArray.let { it[0].jsonPrimitive.content to type(it[1].jsonPrimitive.content) } }, spec.columns)
      assertEquals(id, o.getValue("maxRows").jsonPrimitive.int, spec.maxRows)
      assertEquals(id, o.getValue("pkg").jsonPrimitive.content, spec.pkg)
      assertEquals(id, o.getValue("paged").jsonPrimitive.boolean, spec.paged)
      assertEquals(id, o.getValue("strict").jsonPrimitive.boolean, spec.strict)
      assertTrue(spec.maxRows <= 500)
    }
  }

  @Test fun anUnknownReaderIdIsRefused() {
    assertNull(Readers.plan("inflow.items", null))
    assertNull(Readers.plan("content://com.haroon.inflow.autopilot/items/1", null))
    assertNull(Readers.plan("", 0.0))
  }

  @Test fun aPagedReaderPutsOnlyAWholeNonNegativeNumberInTheUri() {
    assertEquals("content://com.haroon.inflow.autopilot/ask_items/0", Readers.plan("inflow.ask_items", null)?.uri)
    assertEquals("content://com.haroon.inflow.autopilot/ask_ids/42", Readers.plan("inflow.ask_ids", 42.0)?.uri)
    assertEquals("content://com.haroon.inflow.autopilot/debits/9007199254740991", Readers.plan("inflow.debits", 9007199254740991.0)?.uri)
    for (bad in listOf(-1.0, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992.0)) assertNull("$bad", Readers.plan("inflow.ask_items", bad))
  }

  @Test fun deputyRunsTakeNoSinceIdAndClipboardPinsPageByNumber() {
    assertEquals("content://com.haroon.deputy.applink/runs", Readers.plan("deputy.runs", null)?.uri)
    assertNull(Readers.plan("deputy.runs", 3.0))
    assertEquals("content://com.haroon.clipboard.applink/pinned/0", Readers.plan("clipboard.pinned", null)?.uri)
    assertEquals("content://com.haroon.clipboard.applink/pinned/3", Readers.plan("clipboard.pinned", 3.0)?.uri)
    assertNull(Readers.plan("clipboard.pinned", -3.0))
  }

  @Test fun eachReaderExpectsItsSiblingPackage() {
    assertEquals(
      mapOf("inflow.ask_items" to "com.haroon.inflow", "inflow.ask_ids" to "com.haroon.inflow", "inflow.debits" to "com.haroon.inflow", "deputy.runs" to "com.haroon.deputy", "clipboard.pinned" to "com.haroon.clipboard"),
      Readers.SPECS.mapValues { it.value.pkg },
    )
  }

  @Test fun goodRowsComeBackTypedAndNamed() {
    assertEquals(
      listOf(mapOf("id" to 4L, "app" to "sms", "sender" to null, "text" to "Dinner at 8?", "at" to 1764000000000L)),
      Readers.rows(asks, listOf(listOf(4L, "sms", null, "Dinner at 8?", 1764000000000L))),
    )
    assertEquals(mapOf("id" to 2L, "task" to "t", "state" to "done", "finished_at" to 5L), Readers.row(runs, listOf(2, "t", "done", 5.0)))
  }

  @Test fun badRowsAreDroppedAndTheRestKept() {
    val good = listOf(4L, "sms", "Ali", "hi", 1L)
    val rows = Readers.rows(asks, listOf(
      good,
      listOf(0L, "sms", "Ali", "hi", 1L), // id not positive
      listOf(-3L, "sms", "Ali", "hi", 1L),
      listOf(9007199254740992L, "sms", "Ali", "hi", 1L), // id past 2^53-1
      listOf("5", "sms", "Ali", "hi", 1L), // id as text
      listOf(5L, "sms", "Ali", 7L, 1L), // text as a number
      listOf(5L, "sms", "Ali", null, 1L), // text null in a non-null column
      listOf(5L, "sms", "Ali", "hi", 1.5), // at with a fraction
      listOf(5L, "sms", "Ali", "hi", Unit), // a blob
      listOf(5L, "sms", "Ali", "hi"), // a column short
      listOf(5L, "sms", "Ali", "x".repeat(Readers.MAX_TEXT + 1), 1L), // text over 8000
    ))
    assertEquals(listOf(4L), rows?.map { it["id"] })
    assertEquals(1, Readers.rows(asks, listOf(listOf(6L, "sms", null, "x".repeat(Readers.MAX_TEXT), 1L)))?.size)
  }

  @Test fun anItemReadPastMaxRowsIsCut() {
    val many = (1L..(asks.maxRows + 1L)).map { listOf(it, "sms", null, "t", 1L) }
    assertEquals(asks.maxRows, Readers.rows(asks, many)?.size)
  }

  @Test fun aStrictReadWithOneBadRowFailsWhole() {
    val ids = Readers.SPECS.getValue("inflow.ask_ids")
    val pins = Readers.SPECS.getValue("clipboard.pinned")
    assertEquals(listOf(mapOf("id" to 1L), mapOf("id" to 2L)), Readers.rows(ids, listOf(listOf(1L), listOf(2L))))
    assertNull(Readers.rows(ids, listOf(listOf(1L), listOf(0L))))
    assertNull(Readers.rows(runs, listOf(listOf(1L, "t", "done", 1L), listOf(2L, "t", 7L, 1L))))
    assertNull(Readers.rows(pins, listOf(listOf(1L, "x".repeat(Readers.MAX_TEXT + 1), 1L, ""))))
    assertEquals(emptyList<Map<String, Any?>>(), Readers.rows(pins, emptyList()))
  }

  @Test fun aStrictReadPastMaxRowsFailsInsteadOfBeingCut() {
    assertEquals(runs.maxRows, Readers.rows(runs, (1L..runs.maxRows).map { listOf(it, "t", "done", 1L) })?.size)
    assertNull(Readers.rows(runs, (1L..(runs.maxRows + 1L)).map { listOf(it, "t", "done", 1L) }))
  }

  @Test fun onlySnapshotsAndIdListsAreStrict() {
    assertEquals(listOf("inflow.ask_ids", "deputy.runs", "clipboard.pinned"), Readers.SPECS.filterValues { it.strict }.keys.toList())
  }

  @Test fun aMissingColumnFailsTheReadInsteadOfDroppingEveryRow() {
    assertNull(Readers.columnIndexes(runs, listOf("id", "task", "finished_at")))
    assertEquals(listOf(3, 0, 1, 2), Readers.columnIndexes(runs, listOf("task", "state", "finished_at", "id", "extra")))
  }

  @Test fun aGuardThatSaysNoIsRefusedAndEverythingElseFailed() {
    assertEquals(Readers.REFUSED, Readers.statusOf(SecurityException("no")))
    assertEquals(Readers.REFUSED, Readers.statusOf(ExecutionException(SecurityException("no"))))
    assertEquals(Readers.FAILED, Readers.statusOf(TimeoutException()))
    assertEquals(Readers.FAILED, Readers.statusOf(ExecutionException(IllegalArgumentException("bad uri"))))
    assertEquals(Readers.FAILED, Readers.statusOf(RuntimeException()))
  }
}

class ReadersTimeoutTest {
  private val pool = java.util.concurrent.Executors.newFixedThreadPool(2)

  @Test fun aReadPastTheTimeoutFailsWithNoRowsAndIsCancelled() {
    var cancelled = false
    val started = System.nanoTime()
    val answer = Readers.timed(pool, 100, { cancelled = true }) {
      Thread.sleep(5_000)
      Readers.answer(Readers.OK, listOf(mapOf("id" to 1L)))
    }
    assertEquals(Readers.answer(Readers.FAILED), answer)
    assertTrue(cancelled)
    assertTrue((System.nanoTime() - started) / 1_000_000 < 2_000)
  }

  @Test fun aReadInTimeKeepsItsRowsAndAThrownSecurityExceptionIsRefused() {
    assertEquals(Readers.answer(Readers.OK, listOf(mapOf("id" to 1L))), Readers.timed(pool, 1_000, {}) { Readers.answer(Readers.OK, listOf(mapOf("id" to 1L))) })
    assertEquals(Readers.answer(Readers.REFUSED), Readers.timed(pool, 1_000, {}) { throw SecurityException("switch is off") })
    assertEquals(Readers.answer(Readers.FAILED), Readers.timed(pool, 1_000, {}) { throw IllegalStateException() })
  }

  @Test fun theHardTimeoutIsThreeSeconds() = assertEquals(3_000L, Readers.TIMEOUT_MS)
}
