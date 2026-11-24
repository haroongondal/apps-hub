package expo.modules.clipboardcore.core

import expo.modules.clipboardcore.applink.AppLinkGuard
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipLinksTest {
  private fun contract(name: String): JsonElement {
    val f = File("../../../../../packages/app-link-contract/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return Json.parseToJsonElement(f.readText())
  }

  private fun resource(name: String): JsonObject =
    Json.parseToJsonElement(requireNotNull(javaClass.getResource("/applink/$name")) { name }.readText()).jsonObject

  private fun names(o: JsonObject) = o.getValue("columns").jsonArray.map { it.jsonPrimitive.content }

  @Test fun `pinned provider equals its share fixture`() {
    val s = resource("pinned.share.json")
    assertEquals(names(s), ClipLinks.PINNED_COLUMNS.toList())
    assertEquals(s.getValue("authority").jsonPrimitive.content, ClipLinks.AUTHORITY)
    assertEquals(s.getValue("path").jsonPrimitive.content, ClipLinks.PINNED_PATH)
    assertTrue(ClipLinks.PINNED_MAX_ROWS <= s.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun `health provider equals the contract health share`() {
    val s = contract("app-health.share.json").jsonObject
    assertEquals(names(s), ClipLinks.HEALTH_COLUMNS.toList())
    assertEquals(s.getValue("path").jsonPrimitive.content, ClipLinks.HEALTH_PATH)
    assertTrue(ClipLinks.HEALTH_MAX_ROWS <= s.getValue("maxRows").jsonPrimitive.int)
  }

  @Test fun `health row says accessibility, no listener, no AI, and the heartbeat`() {
    assertArrayEquals(arrayOf<Any?>("clipboard", 1, null, "none", 1_764_000_000_000L), ClipLinks.health(true, 1_764_000_000_000L))
    assertArrayEquals(arrayOf<Any?>("clipboard", 0, null, "none", null), ClipLinks.health(false, null))
    assertEquals(ClipLinks.HEALTH_COLUMNS.size, ClipLinks.health(true, null).size)
  }

  @Test fun `only Nexus reads pinned clips, and only with the switch on`() {
    assertTrue(ClipLinks.pinnedReader(true, "com.haroon.pdfeditor"))
    assertFalse(ClipLinks.pinnedReader(false, "com.haroon.pdfeditor"))
    for (other in listOf(null, "", "com.haroon.deputy", "com.haroon.clipboard", "com.haroon.pdfeditor.evil", "com.haroon.pdfeditorx")) {
      assertFalse(other.toString(), ClipLinks.pinnedReader(true, other))
    }
  }

  @Test fun `pinned pages by a numeric since id and nothing else`() {
    assertEquals(0L, ClipLinks.pinnedSince(listOf("pinned")))
    assertEquals(41L, ClipLinks.pinnedSince(listOf("pinned", "41")))
    assertEquals(999_999_999_999_999L, ClipLinks.pinnedSince(listOf("pinned", "999999999999999")))
    for (bad in listOf(listOf("pinned", "-1"), listOf("pinned", "1 OR 1=1"), listOf("pinned", ""), listOf("pinned", "1000000000000000"),
      listOf("pinned", "1", "2"), listOf("health"), listOf("Pinned"), emptyList())) {
      assertNull(bad.toString(), ClipLinks.pinnedSince(bad))
    }
  }

  @Test fun `only pinned text clips become rows, capped at 2000 characters`() {
    assertArrayEquals(arrayOf<Any?>(7L, "hello", 5L, "com.whatsapp"), ClipLinks.pinnedRow(7, "text", "hello", true, 5, "com.whatsapp"))
    assertEquals("", ClipLinks.pinnedRow(7, "text", "hello", true, 5, null)!![3])
    assertNull(ClipLinks.pinnedRow(7, "text", "hello", false, 5, null))
    for (kind in listOf("secret", "code", "image", "file")) assertNull(kind, ClipLinks.pinnedRow(7, kind, "x", true, 5, null))
    assertNull(ClipLinks.pinnedRow(7, "text", null, true, 5, null))
    assertEquals(2000, (ClipLinks.pinnedRow(1, "text", "x".repeat(5000), true, 1, null)!![1] as String).length)
    val split = "x".repeat(1999) + "😀" + "tail"
    assertEquals("x".repeat(1999), ClipLinks.pinnedRow(1, "text", split, true, 1, null)!![1])
    assertEquals(ClipLinks.PINNED_COLUMNS.size, ClipLinks.pinnedRow(1, "text", "t", true, 1, null)!!.size)
  }

  @Test fun `the caller decision matches the contract table`() {
    val rows = contract("caller-decisions.json").jsonArray.map { it.jsonObject }
    assertTrue(rows.size >= 4)
    for (r in rows) {
      val b = { k: String -> r.getValue(k).jsonPrimitive.boolean }
      val d = AppLinkGuard.decide(b("isSelf"), b("holdsPermission"), b("signatureMatches"))
      assertEquals(r.toString(), b("allow"), d.allow)
      assertEquals(r.toString(), r.getValue("reason").jsonPrimitive.content.uppercase().replace('-', '_'), d.reason.name)
    }
  }

  private fun value(e: JsonElement): Any? = when (e) {
    is JsonArray -> e.map { value(it) }
    is JsonObject -> e.getValue("repeat").jsonPrimitive.content.repeat(e.getValue("n").jsonPrimitive.int)
    is JsonPrimitive -> when {
      e.isString -> e.content
      e.content == "true" || e.content == "false" -> e.content.toBoolean()
      e.content.contains('.') -> e.content.toDouble()
      else -> e.content.toLong()
    }
  }

  private val addTodo = contract("add-todo-extras.json").jsonArray.map { it.jsonObject }

  @Test fun `ADD_TODO spec equals the contract fixture`() {
    for (c in addTodo) {
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        AppLinkGuard.ExtraSpec(AppLinkGuard.ExtraType.valueOf(o.getValue("type").jsonPrimitive.content.uppercase()), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      assertEquals(c.getValue("name").jsonPrimitive.content, spec, InflowTodo.SPEC)
    }
  }

  @Test fun `every ADD_TODO fixture case gets its verdict`() {
    assertTrue(addTodo.size >= 10)
    for (c in addTodo) {
      val raw = c.getValue("raw").jsonObject.mapValues { value(it.value) }
      val ok = AppLinkGuard.validateExtras(InflowTodo.SPEC, raw) is AppLinkGuard.ExtrasCheck.Ok
      assertEquals(c.getValue("name").jsonPrimitive.content, c.getValue("ok").jsonPrimitive.boolean, ok)
    }
  }

  @Test fun `the IBAN to-do passes and a broken one is never started`() {
    val title = "Pay account PK36 SCBL 0000 0011 2345 6702"
    assertEquals(mapOf("title" to title, "note" to "From Clipboard", "source" to "Clipboard"), InflowTodo.extras(title, "From Clipboard", "Clipboard"))
    assertNull(InflowTodo.extras("x".repeat(201), "From Clipboard", "Clipboard"))
    assertNull(InflowTodo.extras("a\u0000b", "From Clipboard", "Clipboard"))
    assertNull(InflowTodo.extras("t", "From Clipboard", "x".repeat(41)))
  }

  @Test fun `Inflow result codes`() {
    var started = 0
    assertEquals("not_installed", InflowTodo.launch(false) { started++ })
    assertEquals(0, started)
    assertNull(InflowTodo.launch(true) { started++ })
    assertEquals(1, started)
    assertEquals("refused", InflowTodo.launch(true) { throw SecurityException("no") })
    assertEquals("added", InflowTodo.outcome(true, "added"))
    assertEquals("cancelled", InflowTodo.outcome(false, "cancelled"))
    assertEquals("cancelled", InflowTodo.outcome(false, null))
    assertEquals("refused", InflowTodo.outcome(false, "not_allowed"))
    assertEquals("refused", InflowTodo.outcome(true, "something_else"))
    assertEquals("com.haroon.inflow.action.ADD_TODO", InflowTodo.ACTION)
    assertTrue(InflowTodo.REQUEST_CODE in 0..0xffff)
  }
}
