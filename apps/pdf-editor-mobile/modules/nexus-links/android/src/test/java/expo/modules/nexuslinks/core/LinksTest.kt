package expo.modules.nexuslinks.core

import expo.modules.nexuslinks.applink.AppLinkGuard.ExtraSpec
import expo.modules.nexuslinks.applink.AppLinkGuard.ExtraType
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
import org.junit.Assert.assertTrue
import org.junit.Test

class LinksTest {
  private val addTodo = "com.haroon.inflow.action.ADD_TODO"
  private val proposeTask = "com.haroon.deputy.action.PROPOSE_TASK"

  private fun fixture(name: String): String {
    val f = File("../../../../../packages/app-link-contract/fixtures/$name")
    assertTrue("fixture not found from ${File(".").absoluteFile}", f.isFile)
    return f.readText()
  }

  private fun value(e: JsonElement): Any? = when (e) {
    is JsonNull -> null
    is JsonArray -> e.map { value(it) }
    is JsonObject -> e.getValue("repeat").jsonPrimitive.content.repeat(e.getValue("n").jsonPrimitive.int)
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
    "boolean" -> ExtraType.BOOLEAN
    "stringArray" -> ExtraType.STRING_ARRAY
    else -> throw AssertionError("unknown type $s")
  }

  // Every row of the contract's extras table goes through Links.plan, so the specs Nexus sends with are the specs the receivers check.
  private fun runCases(file: String, action: String) {
    val cases = Json.parseToJsonElement(fixture(file)).jsonArray.map { it.jsonObject }
    assertTrue(cases.size >= 8)
    for (c in cases) {
      val name = c.getValue("name").jsonPrimitive.content
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        ExtraSpec(type(o.getValue("type").jsonPrimitive.content), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      assertEquals(name, Links.TARGETS.getValue(action).spec, spec)
      val plan = Links.plan(action, c.getValue("raw").jsonObject.mapValues { value(it.value) })
      if (c.getValue("ok").jsonPrimitive.boolean) assertTrue(name, plan is Links.Plan.Start)
      else assertEquals(name, Links.Plan.Answer(Links.Result(Links.FAILED, "bad_extras")), plan)
    }
  }

  @Test fun addTodoExtrasGetTheContractVerdicts() = runCases("add-todo-extras.json", addTodo)

  @Test fun proposeTaskExtrasGetTheContractVerdicts() = runCases("propose-task-extras.json", proposeTask)

  @Test fun onlyTheTwoActionsAreAllowedEachToItsOwnApp() {
    assertEquals(mapOf(addTodo to "com.haroon.inflow", proposeTask to "com.haroon.deputy"), Links.TARGETS.mapValues { it.value.pkg })
    assertEquals(Links.Plan.Answer(Links.Result(Links.FAILED, "unknown_action")), Links.plan("com.haroon.inflow.action.DELETE_ALL", mapOf()))
    assertEquals(Links.Plan.Answer(Links.Result(Links.FAILED, "unknown_action")), Links.plan("android.intent.action.VIEW", mapOf("title" to "t")))
  }

  @Test fun aBridgeDoubleBecomesALongExtra() {
    val plan = Links.plan(addTodo, mapOf("title" to "Renew", "dueAt" to 1764000000000.0)) as Links.Plan.Start
    assertEquals(Links.Plan.Start("com.haroon.inflow", addTodo, mapOf("title" to "Renew", "dueAt" to 1764000000000L)), plan)
  }

  @Test fun theResultReadsStatusAndCodeFromTheReceiver() {
    assertEquals(Links.Result(Links.DONE, "added"), Links.result(true, "done", "added"))
    assertEquals(Links.Result(Links.DONE, "handed_over"), Links.result(true, "done", "handed_over"))
    assertEquals(Links.Result(Links.CANCELLED, "cancelled"), Links.result(false, "cancelled", "cancelled"))
    assertEquals(Links.Result(Links.FAILED, "not_allowed"), Links.result(false, "failed", "not_allowed"))
    assertEquals(Links.Result(Links.FAILED, "bad_extras"), Links.result(false, "failed", "bad_extras"))
  }

  @Test fun withoutAnAnswerTheResultCodeDecides() {
    assertEquals(Links.Result(Links.DONE), Links.result(true, null, null))
    assertEquals(Links.Result(Links.CANCELLED), Links.result(false, null, null))
  }

  @Test fun doneNeedsResultOkAndABadCodeIsDropped() {
    assertEquals(Links.Result(Links.CANCELLED, "added"), Links.result(false, "done", "added"))
    assertEquals(Links.Result(Links.CANCELLED), Links.result(true, "maybe", null))
    assertEquals(Links.Result(Links.DONE), Links.result(true, "done", "Added!"))
    assertEquals(Links.Result(Links.DONE), Links.result(true, "done", "x".repeat(41)))
  }

  @Test fun theRequestCodeFitsSixteenBits() = assertTrue(Links.REQUEST_CODE in 1..0xffff)

  @Test fun theResultMapLeavesOutAMissingCode() {
    assertEquals(mapOf("status" to "unavailable"), Links.Result(Links.UNAVAILABLE).toMap())
    assertEquals(mapOf("status" to "done", "code" to "added"), Links.Result(Links.DONE, "added").toMap())
  }
}
