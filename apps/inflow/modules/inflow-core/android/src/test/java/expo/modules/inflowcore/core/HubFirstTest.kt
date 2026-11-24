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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class HubFirstTest {
  private val hubReply = """{"text":"from hub","toolCalls":[],"usage":{"inputTokens":1000,"cachedTokens":0,"outputTokens":500},"model":"openai/gpt-oss-120b"}"""

  private class Own : TextAi {
    var calls = 0
    override fun complete(system: String, user: String, maxTokens: Int): AiReply {
      calls++
      return AiReply("from own", Usage(1, 0, 1))
    }
  }

  private var clock = 0L
  private val pause = HubPause { clock }
  private val recorded = mutableListOf<String>()
  private val sent = mutableListOf<String>()

  private fun hubFirst(own: TextAi, hub: (String) -> String) =
    HubFirst({ sent += it; hub(it) }, own, pause, false, { recorded += it }, { "req-1" })

  private fun throwing(kind: String): (String) -> String = { throw AiHubException(kind, "hub said $kind") }

  @Test fun hubNotAvailableUsesTheOwnKey() {
    val own = Own()
    val r = hubFirst(own, throwing(Kinds.HUB_MISSING)).complete("s", "u")
    assertEquals("from own", r.text)
    assertNull(r.hubModel)
    assertEquals(1, own.calls)
    assertEquals(listOf("own"), recorded)
  }

  @Test fun hubServedNeverCallsTheOwnKey() {
    val own = Own()
    val r = hubFirst(own) { hubReply }.complete("sys", "user")
    assertEquals("from hub", r.text)
    assertEquals("openai/gpt-oss-120b", r.hubModel)
    assertEquals(Usage(1000, 0, 500), r.usage)
    assertEquals(0, own.calls)
    assertEquals(listOf("hub"), recorded)
  }

  @Test fun everyFallBackKindMidCallUsesTheOwnKeyExactlyOnce() {
    for (kind in listOf(Kinds.HUB_MISSING, Kinds.NOT_ALLOWED, Kinds.VERSION, Kinds.NO_KEY, Kinds.TOO_LARGE)) {
      val own = Own()
      var hubCalls = 0
      val ai = HubFirst({ hubCalls++; throw AiHubException(kind, "x") }, own, HubPause { 0L }, false, {}, { "id" })
      assertEquals("from own", ai.complete("s", "u").text)
      assertEquals(kind, 1, own.calls)
      // Once the hub failed, the rest of this run goes straight to the own key: no hub retry loop.
      ai.complete("s", "u2")
      assertEquals(kind, 1, hubCalls)
      assertEquals(kind, 2, own.calls)
    }
  }

  @Test fun otherHubErrorsSurfaceWithoutTryingTheOwnKey() {
    for (kind in listOf(Kinds.BUSY, Kinds.TIMEOUT, Kinds.PROVIDER, Kinds.INVALID, Kinds.CANCELLED)) {
      val own = Own()
      try {
        hubFirst(own, throwing(kind)).complete("s", "u")
        fail(kind)
      } catch (e: AiError) {
        assertEquals(kind, if (kind == Kinds.TIMEOUT) AiError.Kind.TIMEOUT else AiError.Kind.SERVER, e.kind)
      }
      assertEquals(kind, 0, own.calls)
    }
    assertTrue(recorded.isEmpty())
  }

  @Test fun anOwnKeyErrorAfterAFallBackSurfacesAndIsNotRetried() {
    var ownCalls = 0
    val own = object : TextAi {
      override fun complete(system: String, user: String, maxTokens: Int): AiReply {
        ownCalls++
        throw AiError(AiError.Kind.AUTH, "refused")
      }
    }
    try {
      hubFirst(own, throwing(Kinds.NO_KEY)).complete("s", "u")
      fail()
    } catch (e: AiError) {
      assertEquals(AiError.Kind.AUTH, e.kind)
    }
    assertEquals(1, ownCalls)
  }

  @Test fun anUnreadableHubReplyIsAnErrorNotASecondPaidCall() {
    val own = Own()
    try {
      hubFirst(own) { """{"text":"no model"}""" }.complete("s", "u")
      fail()
    } catch (e: AiError) {
      assertEquals(AiError.Kind.SERVER, e.kind)
    }
    assertEquals(0, own.calls)
  }

  @Test fun notAllowedIsRememberedForTenMinutesAcrossInstances() {
    hubFirst(Own(), throwing(Kinds.NOT_ALLOWED)).complete("s", "u")
    assertEquals(1, sent.size)
    clock = HubPause.MS - 1
    hubFirst(Own()) { hubReply }.complete("s", "u")
    assertEquals(1, sent.size)
    clock = HubPause.MS
    assertEquals("from hub", hubFirst(Own()) { hubReply }.complete("s", "u").text)
    assertEquals(2, sent.size)
  }

  @Test fun hubMissingIsNotRememberedPastTheInstance() {
    hubFirst(Own(), throwing(Kinds.HUB_MISSING)).complete("s", "u")
    assertFalse(pause.paused())
  }

  @Test fun theRequestIsTheHubsTextChatJobAndPassesTheClientsChecks() {
    hubFirst(Own()) { hubReply }.complete("system text", "user text", 8_000)
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
  }

  @Test fun aHubReplyIsPricedFromItsModelWhenKnownElseNotCounted() {
    val ownPrices = Prices(100.0, 100.0, 100.0)
    val groq = HubChat.parse(hubReply, 10)
    assertEquals(AiModels.known(AiModels.GROQ_URL, "openai/gpt-oss-120b")!!.prices.cost(groq.usage), ownPrices.cost(groq), 1e-12)
    val unknown = HubChat.parse(hubReply.replace("openai/gpt-oss-120b", "some-new-model"), 10)
    assertEquals(0.0, ownPrices.cost(unknown), 0.0)
    assertEquals(ownPrices.cost(Usage(1, 0, 1)), ownPrices.cost(AiReply("x", Usage(1, 0, 1))), 0.0)
  }
}
