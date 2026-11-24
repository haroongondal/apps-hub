package expo.modules.designmedia.core

import expo.modules.designmedia.applink.AppLinkGuard
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLinksTest {
  private fun contract(name: String): JsonElement {
    val f = File("../../../../../packages/app-link-contract/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return Json.parseToJsonElement(f.readText())
  }

  @Test fun theHealthRowIsTheContractHealthShare() {
    val share = contract("app-health.share.json").jsonObject
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, AppHealth.COLUMNS.toList())
    assertEquals(share.getValue("path").jsonPrimitive.content, AppHealth.PATH)
    assertTrue(AppHealth.LIMIT <= share.getValue("maxRows").jsonPrimitive.int)
    assertEquals("com.haroon.designeditor.applink", AppHealth.AUTHORITY)
  }

  @Test fun oneRowWithNoPersonalDataAndOnlyTheThreeAiSources() {
    val rows = AppHealth.rows("hub\n", "1764000000000")
    assertEquals(1, rows.size)
    assertArrayEquals(arrayOf<Any?>("design-editor", null, null, "hub", 1_764_000_000_000L), rows[0])
    assertEquals("own", AppHealth.aiSource("own"))
    listOf(null, "", "HUB", "gemini", "hub own").forEach { assertEquals(it, "none", AppHealth.aiSource(it)) }
    listOf(null, "", "soon", "-5", "0").forEach { assertNull(it, AppHealth.lastSeen(it)) }
    assertEquals(AppHealth.COLUMNS.size, AppHealth.rows(null, null)[0].size)
  }

  @Test fun theGuardCopyDecidesEveryCallerAsTheContractSays() {
    val rows = contract("caller-decisions.json").jsonArray.map { it.jsonObject }
    assertTrue(rows.size >= 4)
    for (r in rows) {
      val b = { k: String -> r.getValue(k).jsonPrimitive.boolean }
      assertEquals(r.toString(), b("allow"), AppLinkGuard.decide(b("isSelf"), b("holdsPermission"), b("signatureMatches")).allow)
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

  private fun type(s: String) = AppLinkGuard.ExtraType.valueOf(if (s == "stringArray") "STRING_ARRAY" else s.uppercase())

  @Test fun deputySpecIsTheFixtureSpecAndEveryCaseGetsItsVerdict() {
    val cases = contract("propose-task-extras.json").jsonArray.map { it.jsonObject }
    assertTrue(cases.size >= 10)
    for (c in cases) {
      val name = c.getValue("name").jsonPrimitive.content
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        AppLinkGuard.ExtraSpec(type(o.getValue("type").jsonPrimitive.content), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      assertEquals(name, spec, DeputyProposal.SPEC)
      val raw = c.getValue("raw").jsonObject.mapValues { value(it.value) }
      assertEquals(name, c.getValue("ok").jsonPrimitive.boolean, AppLinkGuard.validateExtras(DeputyProposal.SPEC, raw) is AppLinkGuard.ExtrasCheck.Ok)
    }
  }

  @Test fun deputyGetsTheTaskAndOnlyAChosenApp() {
    assertEquals(mapOf("task" to "Send it to Sara."), DeputyProposal.extras("Send it to Sara.", emptyList()))
    assertEquals(mapOf("task" to "t", "apps" to listOf("com.whatsapp")), DeputyProposal.extras("t", listOf("com.whatsapp")))
    assertNull(DeputyProposal.extras("x".repeat(301), emptyList()))
    assertNull(DeputyProposal.extras("a\u0000b", emptyList()))
    assertNull(DeputyProposal.extras("t", List(21) { "a" }))
  }

  @Test fun deputyAnswersBecomeOneOfTheOutcomesTheScreenKnows() {
    assertEquals("handed_over", DeputyProposal.outcome(true, "handed_over"))
    assertEquals("cancelled", DeputyProposal.outcome(false, "cancelled"))
    assertEquals("cancelled", DeputyProposal.outcome(false, null))
    assertEquals("refused", DeputyProposal.outcome(false, "not_allowed"))
    assertEquals("refused", DeputyProposal.outcome(true, "something_else"))
    assertEquals("com.haroon.deputy.action.PROPOSE_TASK", DeputyProposal.ACTION)
    assertTrue(DeputyProposal.REQUEST_CODE in 0..0xffff && DeputyProposal.REQUEST_CODE != TrashAction.TRASH.requestCode && DeputyProposal.REQUEST_CODE != TrashAction.RESTORE.requestCode)
  }

  @Test fun nexusGetsOneToTenGalleryPhotosAndNothingElse() {
    val base = "content://media/external/images/media"
    val photos = (1..10).map { "$base/$it" }
    assertEquals((1L..10L).toList(), NexusShare.ids(photos, base))
    assertNull(NexusShare.ids(emptyList(), base))
    assertNull(NexusShare.ids(photos + "$base/11", base))
    assertNull(NexusShare.ids(listOf("$base/1", "content://com.haroon.designeditor.fileprovider/files/x.png"), base))
    assertNull(NexusShare.ids(listOf("file:///data/data/com.haroon.designeditor/files/ai-source.txt"), base))
    assertNull(NexusShare.ids(listOf("$base/1", "$base/1"), base))
    assertEquals("com.haroon.pdfeditor", NexusShare.PACKAGE)
  }

  @Test fun photoTimesKeepTheWindowOldestFirstAndFallBackToTheEditTime() {
    assertEquals(5_000L, PhotoTimes.takenAt(5_000, 9))
    assertEquals(9_000L, PhotoTimes.takenAt(null, 9))
    assertEquals(9_000L, PhotoTimes.takenAt(0, 9))
    val rows = listOf(1L to 300L, 2L to 100L, 3L to 200L, 4L to 400L, 5L to 200L)
    assertEquals(listOf(2L to 100L, 3L to 200L, 5L to 200L, 1L to 300L), PhotoTimes.within(rows, 100, 400, null))
    assertEquals(listOf(5L to 200L), PhotoTimes.within(rows, 0, Long.MAX_VALUE, setOf(5L, 99L)))
    assertEquals(PhotoTimes.LIMIT, PhotoTimes.within((1L..600L).map { it to it }, 0, Long.MAX_VALUE, null).size)
  }
}
