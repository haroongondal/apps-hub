package expo.modules.inflowcore.core

import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.HubLimits
import expo.modules.aihubclient.core.Kinds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class HubAiTest {
  private val hubReply = FakeHub.reply("from hub", Usage(1000, 0, 500))
  private var answered = 0
  private val sent = mutableListOf<String>()

  private fun ai(hub: (String) -> String) = FakeHub.ai(answered = { answered++ }) { sent += it; hub(it) }

  private fun errorOf(kind: String): AiError {
    try {
      ai { throw AiHubException(kind, "SECRET hub text for $kind") }.complete("s", "u")
    } catch (e: AiError) {
      return e
    }
    fail(kind)
    throw IllegalStateException()
  }

  @Test fun aReplyIsTheHubsTextAndModelAndTellsTheCleanup() {
    val r = ai { hubReply }.complete("sys", "user")
    assertEquals("from hub", r.text)
    assertEquals("openai/gpt-oss-120b", r.model)
    assertEquals(Usage(1000, 0, 500), r.usage)
    assertEquals(1, answered)
  }

  @Test fun everyHubErrorIsAPlainTypedFailureWithNoSecondRequestAndNoCleanup() {
    val expected = mapOf(
      Kinds.HUB_MISSING to (AiError.Kind.HUB_MISSING to HubCopy.MISSING),
      Kinds.NOT_ALLOWED to (AiError.Kind.NOT_ALLOWED to HubCopy.NOT_ALLOWED),
      Kinds.VERSION to (AiError.Kind.VERSION to HubCopy.VERSION),
      Kinds.NO_KEY to (AiError.Kind.NO_KEY to HubCopy.NO_KEY),
      Kinds.TOO_LARGE to (AiError.Kind.BAD_REQUEST to HubCopy.REFUSED),
      Kinds.INVALID to (AiError.Kind.BAD_REQUEST to HubCopy.REFUSED),
      Kinds.BUSY to (AiError.Kind.SERVER to HubCopy.BUSY),
      Kinds.TIMEOUT to (AiError.Kind.TIMEOUT to HubCopy.TIMEOUT),
      Kinds.PROVIDER to (AiError.Kind.SERVER to HubCopy.FAILED),
      Kinds.CANCELLED to (AiError.Kind.SERVER to HubCopy.FAILED),
    )
    for ((kind, want) in expected) {
      sent.clear()
      val e = errorOf(kind)
      assertEquals(kind, want.first, e.kind)
      assertEquals(kind, want.second, e.message)
      assertFalse(kind, e.message!!.contains("SECRET"))
      assertEquals(kind, 1, sent.size)
    }
    assertEquals(0, answered)
  }

  @Test fun onlyAHubThatIsNotReadyWaits() {
    val waits = AiError.Kind.values().filter { it.waits }.toSet()
    assertEquals(setOf(AiError.Kind.HUB_MISSING, AiError.Kind.NOT_ALLOWED, AiError.Kind.VERSION, AiError.Kind.NO_KEY), waits)
  }

  @Test fun anUnreadableHubReplyIsAnErrorNotASecondPaidCall() {
    try {
      ai { """{"text":"no model"}""" }.complete("s", "u")
      fail()
    } catch (e: AiError) {
      assertEquals(AiError.Kind.SERVER, e.kind)
      assertEquals(HubCopy.UNREADABLE, e.message)
    }
    assertEquals(1, sent.size)
    assertEquals(0, answered)
  }

  @Test fun theRequestIsTheHubsTextChatJobAndPassesTheClientsChecks() {
    ai { hubReply }.complete("system text", "user text", 8_000)
    val json = sent.single()
    val checked = HubLimits.check(json, null)
    assertEquals("chat", checked.job)
    assertEquals(1, checked.apiVersion)
    val o = Json.parseToJsonElement(json).jsonObject
    assertEquals(setOf("apiVersion", "requestId", "job", "priority", "messages", "maxTokens"), o.keys)
    assertEquals("background", o["priority"]!!.jsonPrimitive.content)
    assertEquals(8_000, o["maxTokens"]!!.jsonPrimitive.int)
    val m = o["messages"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("system", "user"), m.map { it["role"]!!.jsonPrimitive.content })
    assertEquals(listOf("system text", "user text"), m.map { it["content"]!!.jsonPrimitive.content })
    assertEquals(8_192, Json.parseToJsonElement(HubChat.request("a", true, "s", "u", 100_000)).jsonObject["maxTokens"]!!.jsonPrimitive.int)
    assertEquals("foreground", Json.parseToJsonElement(HubChat.request("a", true, "s", "u", 1)).jsonObject["priority"]!!.jsonPrimitive.content)
  }

  @Test fun aHubReplyIsPricedFromItsModelWhenKnownElseAtTheDearestKnownModel() {
    val groq = HubChat.parse(hubReply, 10)
    assertEquals(AiPricing.KNOWN.getValue("openai/gpt-oss-120b").cost(groq.usage), AiPricing.cost(groq), 1e-12)
    val unknown = HubChat.parse(hubReply.replace("openai/gpt-oss-120b", "some-new-model"), 10)
    val dearest = AiPricing.KNOWN.values.maxOf { it.cost(unknown.usage) }
    assertTrue(dearest > 0.0)
    assertEquals(dearest, AiPricing.cost(unknown), 1e-12)
    assertEquals(dearest, AiPricing.cost(AiReply("x", Usage(1000, 0, 500))), 1e-12)
  }
}
