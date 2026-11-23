package expo.modules.inflowcore.core

import expo.modules.inflowcore.applink.AppLinkGuard.ExtraSpec
import expo.modules.inflowcore.applink.AppLinkGuard.ExtraType
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddTodoTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private val cases = File("../../../../../packages/app-link-contract/fixtures/add-todo-extras.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonArray.map { c -> c.jsonObject } }

  private fun value(e: JsonElement): Any? = when (e) {
    is JsonNull -> null
    is JsonArray -> e.map { value(it) }
    is JsonObject -> e.getValue("repeat").jsonPrimitive.content.repeat(e.getValue("n").jsonPrimitive.int) // {"repeat":"x","n":200}
    is JsonPrimitive -> when {
      e.isString -> e.content
      e.content == "true" || e.content == "false" -> e.content.toBoolean()
      e.content.any { it == '.' || it == 'e' || it == 'E' } -> e.content.toDouble()
      else -> e.content.toLong()
    }
  }

  private fun type(s: String) = when (s) {
    "string" -> ExtraType.STRING
    "long" -> ExtraType.LONG
    else -> throw AssertionError("unexpected type $s")
  }

  @Test fun theSpecEqualsTheFixtureSpecInEveryRow() {
    assertEquals(13, cases.size)
    for (c in cases) {
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        ExtraSpec(type(o.getValue("type").jsonPrimitive.content), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      assertEquals(c.getValue("name").jsonPrimitive.content, spec, AddTodo.SPEC)
    }
  }

  @Test fun everyFixtureRowGetsTheSameVerdictAndTheNamedReason() {
    for (c in cases) {
      val name = c.getValue("name").jsonPrimitive.content
      val parsed = AddTodo.parse(c.getValue("raw").jsonObject.mapValues { value(it.value) })
      if (c.getValue("ok").jsonPrimitive.boolean) assertTrue(name, parsed is AddTodoParse.Ok)
      else {
        val reason = (parsed as? AddTodoParse.Rejected)?.reason ?: throw AssertionError("$name was accepted")
        assertTrue("$name: $reason", reason.contains(c.getValue("reason").jsonPrimitive.content, ignoreCase = true))
      }
    }
  }

  @Test fun everyExtraComesThroughAndSourceIsDropped() {
    val ok = AddTodo.parse(mapOf("title" to "Claim the warranty", "dueAt" to 1764000000000L, "note" to "Receipt is in Nexus", "source" to "nexus")) as AddTodoParse.Ok
    assertEquals(AddTodoRequest("Claim the warranty", 1764000000000L, "Receipt is in Nexus"), ok.request)
  }

  @Test fun theTitleIsTrimmedAndATitleOfSpacesIsRefused() {
    assertEquals("Pay rent", (AddTodo.parse(mapOf("title" to "  Pay rent \n")) as AddTodoParse.Ok).request.title)
    for (t in listOf("", " ", "  \t\n ")) assertEquals("title is empty", (AddTodo.parse(mapOf("title" to t)) as AddTodoParse.Rejected).reason)
  }

  @Test fun aBlankNoteIsNoNote() {
    assertNull((AddTodo.parse(mapOf("title" to "t", "note" to "  ")) as AddTodoParse.Ok).request.note)
  }

  @Test fun aDoubleDueDateFromTheReactNativeBridgeIsAccepted() {
    assertEquals(1764000000000L, (AddTodo.parse(mapOf("title" to "t", "dueAt" to 1764000000000.0)) as AddTodoParse.Ok).request.dueAt)
  }

  @Test fun theResultsAreTheOnesLinksTsDeclares() {
    assertEquals(listOf("done", "added", "cancelled", "cancelled"), listOf(AddTodo.STATUS_DONE, AddTodo.CODE_ADDED, AddTodo.STATUS_CANCELLED, AddTodo.CODE_CANCELLED))
    assertEquals("com.haroon.inflow.action.ADD_TODO", AddTodo.ACTION)
  }

  // The flow: what the Add tap may write.
  private class Saved {
    val rows = mutableListOf<Pair<String, Long?>>()
    var fail = false
    val save: (String, Long?) -> Unit = { t, d -> if (fail) throw IllegalStateException("db") else rows.add(t to d) }
  }

  private val request = AddTodoRequest("Renew the car insurance", 1764000000000L, "note")

  @Test fun nothingIsWrittenWhileLockedNoMatterHowOftenAddIsTapped() {
    val saved = Saved()
    val flow = AddTodoFlow(request, saved.save)
    repeat(3) { assertEquals(AddTodoFlow.Outcome.LOCKED, flow.add("Renew the car insurance")) }
    assertEquals(emptyList<Pair<String, Long?>>(), saved.rows)
  }

  @Test fun nothingIsWrittenWhenTheOwnerCancelsOrNeverTapsAdd() {
    val saved = Saved()
    AddTodoFlow(request, saved.save).unlocked()   // unlocked, then the owner taps Cancel or Back: add is never called
    assertEquals(0, saved.rows.size)
  }

  @Test fun addAfterUnlockWritesExactlyOneRowWithTheEditedTitleAndTheDueDate() {
    val saved = Saved()
    val flow = AddTodoFlow(request, saved.save)
    flow.unlocked()
    assertEquals(AddTodoFlow.Outcome.ADDED, flow.add("  Renew the car insurance by Friday "))
    assertEquals(AddTodoFlow.Outcome.ALREADY_ADDED, flow.add("Renew the car insurance by Friday"))
    assertEquals(listOf("Renew the car insurance by Friday" to 1764000000000L), saved.rows)
  }

  @Test fun anEmptiedTitleIsNotWrittenAndAFailedWriteIsReportedNotHidden() {
    val saved = Saved()
    val flow = AddTodoFlow(request, saved.save)
    flow.unlocked()
    assertEquals(AddTodoFlow.Outcome.EMPTY, flow.add("   "))
    saved.fail = true
    assertEquals(AddTodoFlow.Outcome.FAILED, flow.add("x"))
    saved.fail = false
    assertEquals(AddTodoFlow.Outcome.ADDED, flow.add("x"))   // a failed write does not use up the one add
    assertEquals(1, saved.rows.size)
  }
}
