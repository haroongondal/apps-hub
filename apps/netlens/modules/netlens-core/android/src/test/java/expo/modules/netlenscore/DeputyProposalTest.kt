package expo.modules.netlenscore

import expo.modules.netlenscore.applink.AppLinkGuard
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binds DeputyProposal.SPEC to the contract's PROPOSE_TASK fixture and runs every case through it. */
class DeputyProposalTest {
  private val cases = File("../../../../../packages/app-link-contract/fixtures/propose-task-extras.json")
    .also { assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile) }
    .let { Json.parseToJsonElement(it.readText()).jsonArray.map { c -> c.jsonObject } }

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

  @Test fun specEqualsTheFixtureSpec() {
    for (c in cases) {
      val spec = c.getValue("spec").jsonObject.mapValues { (_, v) ->
        val o = v.jsonObject
        AppLinkGuard.ExtraSpec(type(o.getValue("type").jsonPrimitive.content), o["max"]?.jsonPrimitive?.int, o["required"]?.jsonPrimitive?.boolean ?: false)
      }
      assertEquals(c.getValue("name").jsonPrimitive.content, spec, DeputyProposal.SPEC)
    }
  }

  @Test fun everyFixtureCaseGetsItsVerdict() {
    assertTrue(cases.size >= 10)
    for (c in cases) {
      val raw = c.getValue("raw").jsonObject.mapValues { value(it.value) }
      val ok = AppLinkGuard.validateExtras(DeputyProposal.SPEC, raw) is AppLinkGuard.ExtrasCheck.Ok
      assertEquals(c.getValue("name").jsonPrimitive.content, c.getValue("ok").jsonPrimitive.boolean, ok)
    }
  }

  @Test fun extrasCarryTheTaskAndOnlyNonBlankContext() {
    assertEquals(mapOf("task" to "Restart my router"), DeputyProposal.extras("Restart my router", ""))
    assertEquals(mapOf("task" to "t"), DeputyProposal.extras("t", "   "))
    assertEquals(mapOf("task" to "t", "context" to "Archer C6"), DeputyProposal.extras("t", "Archer C6"))
  }

  @Test fun overLongOrEmptyExtrasAreRefused() {
    assertEquals(mapOf("task" to "x".repeat(300)), DeputyProposal.extras("x".repeat(300), ""))
    assertNull(DeputyProposal.extras("x".repeat(301), ""))
    assertNull(DeputyProposal.extras("t", "x".repeat(2001)))
    assertNull(DeputyProposal.extras("a\u0000b", ""))
  }

  @Test fun deputyResultCodes() {
    assertEquals("handed_over", DeputyProposal.outcome(true, "handed_over"))
    assertEquals("cancelled", DeputyProposal.outcome(false, "cancelled"))
    assertEquals("cancelled", DeputyProposal.outcome(false, null))
    assertEquals("refused", DeputyProposal.outcome(false, "not_allowed"))
    assertEquals("refused", DeputyProposal.outcome(false, "bad_extras"))
    assertEquals("refused", DeputyProposal.outcome(true, "something_else"))
  }

  @Test fun theActionAndRequestCodeAreSafe() {
    assertEquals("com.haroon.deputy.action.PROPOSE_TASK", DeputyProposal.ACTION)
    assertEquals("com.haroon.deputy", DeputyProposal.DEPUTY_PACKAGE)
    assertTrue(DeputyProposal.REQUEST_CODE in 0..0xffff)
  }

  @Test fun anUntrustedDeputyIsNotInstalledAndNothingStarts() {
    var started = false
    assertEquals("not_installed", DeputyProposal.start(trusted = { false }, go = { started = true }))
    assertTrue("nothing may be sent", !started)
  }

  @Test fun aTrustedDeputyIsStarted() {
    var started = false
    assertNull(DeputyProposal.start(trusted = { true }, go = { started = true }))
    assertTrue(started)
  }
}
