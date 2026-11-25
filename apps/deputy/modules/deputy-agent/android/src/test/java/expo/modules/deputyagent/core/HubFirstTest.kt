package expo.modules.deputyagent.core

import expo.modules.aihubclient.core.AiHubException
import expo.modules.aihubclient.core.Kinds
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class HubFirstTest {
  private val signed = """{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"tap","arguments":"{\"index\":2}"},"extra_content":{"google":{"thought_signature":"SIG=="}}}],"reasoning_details":[{"x":1}]}"""
  private fun reply(raw: String = signed, model: String = "gemini-3.5-flash-lite", calls: String = """[{"id":"c1","name":"tap","args":{"index":2}}]""") =
    """{"text":null,"toolCalls":$calls,"usage":{"inputTokens":1200,"cachedTokens":200,"outputTokens":30},"model":"$model","service":"gemini","raw":$raw}"""

  private class FakeHub(vararg results: Any) : HubCall {
    val queue = ArrayDeque(results.toList())
    val requests = mutableListOf<JsonObject>()
    val shots = mutableListOf<String?>()
    override suspend fun submit(requestJson: String, jpegBase64: String?): String {
      requests += Json.parseToJsonElement(requestJson).jsonObject
      shots += jpegBase64
      return when (val r = queue.removeFirst()) {
        is String -> r
        is AiHubException -> throw r
        else -> error("bad fixture")
      }
    }
  }

  private class FakeOwn : LlmProvider {
    var calls = 0
    override suspend fun step(history: List<Msg>, tools: List<ToolSpec>): ModelTurn {
      calls++
      return ModelTurn(Msg("assistant", buildJsonObject { put("role", "assistant"); put("content", "own") }), emptyList(), Usage(1, 0, 1), "own")
    }
  }

  private val tools = listOf(ToolSpec("tap", "Tap an element", buildJsonObject { put("type", "object") }))
  private val history = listOf(Msgs.system("SYSTEM"), Msgs.user("The owner's task: t"), Msgs.user("<notification>hi &lt;</notification>"), Msgs.user("<screen>\nSend\n</screen>"))
  private var clock = 0L
  private var n = 0
  private fun TestScope.first(hub: FakeHub, own: FakeOwn = FakeOwn(), pause: HubPause = HubPause { testScheduler.currentTime + clock }, sources: MutableList<String> = mutableListOf()) =
    HubFirst(hub, own, pause, sources::add) { "dep-${++n}" }

  private suspend fun failure(block: suspend () -> Unit): ProviderError {
    try {
      block()
    } catch (e: ProviderError) {
      return e
    }
    fail("expected a ProviderError")
    throw AssertionError()
  }

  @Test fun theFirstStepGoesToTheHubAsAVersionThreeChatPinnedToGeminiWithRequiredToolChoice() = runTest {
    val hub = FakeHub(reply())
    val own = FakeOwn()
    val sources = mutableListOf<String>()
    val turn = first(hub, own, sources = sources).step(history, tools)
    val req = hub.requests.single()
    assertEquals(listOf("3", "chat", "gemini", "required", "foreground", "dep-1"), listOf("apiVersion", "job", "service", "toolChoice", "priority", "requestId").map { req[it]!!.jsonPrimitive.content })
    assertEquals("tap", req["tools"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
    assertEquals(history.map { it.json }, req["messages"]!!.jsonArray.toList())
    assertNull(hub.shots.single())
    assertEquals(0, own.calls)
    assertEquals(listOf("hub"), sources)
    assertEquals("gemini-3.5-flash-lite", turn.hubModel)
    assertEquals(listOf("c1"), turn.toolCalls.map { it.id })
  }

  @Test fun theAssistantMessageComesBackAndGoesOutAgainUnchangedSignatureIncluded() = runTest {
    val hub = FakeHub(reply(), reply(calls = "[]"))
    val provider = first(hub)
    val turn = provider.step(history, tools)
    assertEquals(Json.parseToJsonElement(signed), turn.raw.json)
    val next = history + turn.raw + Msgs.tool("c1", "ok") + Msgs.user("<screen>two</screen>")
    provider.step(next, tools)
    val sent = hub.requests[1]["messages"]!!.jsonArray
    assertEquals(Json.parseToJsonElement(signed), sent[history.size])
    assertTrue("SIG==" in sent[history.size].toString())
  }

  @Test fun theScreenshotRidesAsTheVisionPictureAndNeverInline() = runTest {
    val hub = FakeHub(reply())
    val shot = listOf(Msgs.system("S"), Msgs.user("The owner's task: t"), Msgs.user("<screen>x</screen>", "QUJD"))
    first(hub).step(shot, tools)
    val req = hub.requests.single()
    assertEquals(listOf("vision", "image/jpeg", "gemini"), listOf("job", "mime", "service").map { req[it]!!.jsonPrimitive.content })
    assertEquals("QUJD", hub.shots.single())
    assertFalse("data:image" in req.toString() || "QUJD" in req.toString() || "image_url" in req.toString())
    assertEquals("<screen>x</screen>", req["messages"]!!.jsonArray.last().jsonObject["content"]!!.jsonArray.single().jsonObject["text"]!!.jsonPrimitive.content)
  }

  @Test fun everyContentPartDeputySendsIsATextPartOrADataImagePart() = runTest {
    val hub = FakeHub(reply(), reply())
    val provider = first(hub)
    provider.step(listOf(Msgs.system("S"), Msgs.user("t"), Msgs.user("<screen>x</screen>", "QUJD")), tools)
    provider.step(history, tools)
    for (req in hub.requests) for (m in req["messages"]!!.jsonArray) {
      val parts = m.jsonObject["content"] as? JsonArray ?: continue
      for (part in parts) {
        val o = part.jsonObject
        val type = o["type"]!!.jsonPrimitive.content
        assertTrue(type == "text" || (type == "image_url" && o["image_url"]!!.jsonObject["url"]!!.jsonPrimitive.content.startsWith("data:image/")))
      }
    }
  }

  @Test fun aStepAboveTheLimitWithItsScreenshotInlineWouldNotFitButTheAttachedOneDoes() = runTest {
    val hub = FakeHub(reply())
    val big = "A".repeat(300_000)
    first(hub).step(listOf(Msgs.system("S"), Msgs.user("t".repeat(62_000)), Msgs.user("<screen>x</screen>", big)), tools)
    assertTrue(hub.requests.single().toString().toByteArray().size < 70_000)
  }

  @Test fun everyFallBackKindMovesTheWholeRunToTheOwnKeyAndTriesTheHubOnce() = runTest {
    for (kind in listOf(Kinds.HUB_MISSING, Kinds.NOT_ALLOWED, Kinds.VERSION, Kinds.NO_KEY, Kinds.TOO_LARGE)) {
      val hub = FakeHub(AiHubException(kind, "m"))
      val own = FakeOwn()
      val sources = mutableListOf<String>()
      val provider = first(hub, own, pause = HubPause { 0 }, sources = sources)
      provider.step(history, tools)
      provider.step(history, tools)
      assertEquals(kind, 1, hub.requests.size)
      assertEquals(kind, 2, own.calls)
      assertEquals(kind, listOf("own", "own"), sources)
    }
  }

  @Test fun notAllowedPausesTheHubForTenMinutesAcrossRuns() = runTest {
    var now = 0L
    val pause = HubPause { now }
    val hub = FakeHub(AiHubException(Kinds.NOT_ALLOWED, "m"), reply())
    HubFirst(hub, FakeOwn(), pause, {}) { "a" }.step(history, tools)
    val second = FakeOwn()
    HubFirst(hub, second, pause, {}) { "b" }.step(history, tools)
    assertEquals(1, hub.requests.size)
    assertEquals(1, second.calls)
    now = HubPause.MS
    HubFirst(hub, FakeOwn(), pause, {}) { "c" }.step(history, tools)
    assertEquals(2, hub.requests.size)
  }

  @Test fun aPauseThatEndsMidRunNeverMovesARunThatStartedOnTheOwnKeyToTheHub() = runTest {
    var now = 0L
    val pause = HubPause { now }
    pause.pause()
    val hub = FakeHub()
    val own = FakeOwn()
    val provider = HubFirst(hub, own, pause, {}) { "a" }
    provider.step(history, tools)
    now = HubPause.MS
    provider.step(history, tools)
    assertTrue(hub.requests.isEmpty())
    assertEquals(2, own.calls)
  }

  @Test fun negativeTokenCountsFromTheHubNeverLowerTheCost() = runTest {
    val odd = """{"text":null,"toolCalls":[],"usage":{"inputTokens":-5,"cachedTokens":-1,"outputTokens":-9},"model":"m","service":"gemini","raw":$signed}"""
    assertEquals(Usage(0, 0, 0), first(FakeHub(odd)).step(history, tools).usage)
  }

  @Test fun otherFailuresSurfaceWithoutTryingTheOwnKey() = runTest {
    for ((kind, expected) in listOf(
      Kinds.INVALID to ProviderError.Kind.BAD_REQUEST, Kinds.TIMEOUT to ProviderError.Kind.SERVER, Kinds.CANCELLED to ProviderError.Kind.SERVER,
    )) {
      val own = FakeOwn()
      val sources = mutableListOf<String>()
      val e = failure { first(FakeHub(AiHubException(kind, "AI hub said $kind")), own, sources = sources).step(history, tools) }
      assertEquals(kind, expected, e.kind)
      assertEquals("AI hub said $kind", e.message)
      assertEquals(kind, 0, own.calls)
      assertTrue(sources.isEmpty())
    }
  }

  @Test fun aLimitAtTheHubIsWaitedOutLikeTheOwnKeysRateLimit() = runTest {
    val hub = FakeHub(AiHubException(Kinds.BUSY, "busy"), AiHubException(Kinds.BUSY, "busy"), reply())
    val own = FakeOwn()
    first(hub, own).step(history, tools)
    assertEquals(3, hub.requests.size)
    assertEquals(30_000L, testScheduler.currentTime)
    assertEquals(0, own.calls)
  }

  @Test fun aHubThatStaysBusyEndsTheStepAfterTheThreeWaitsAndNeverUsesTheOwnKey() = runTest {
    val hub = FakeHub(*Array(4) { AiHubException(Kinds.BUSY, "busy") })
    val own = FakeOwn()
    val e = failure { first(hub, own).step(history, tools) }
    assertEquals(ProviderError.Kind.SERVER, e.kind)
    assertEquals(4, hub.requests.size)
    assertEquals(60_000L, testScheduler.currentTime)
    assertEquals(0, own.calls)
  }

  @Test fun aFailingServiceIsRetriedOneTwoFourSecondsThenSurfaces() = runTest {
    val hub = FakeHub(*Array(4) { AiHubException(Kinds.PROVIDER, "failed") })
    val e = failure { first(hub).step(history, tools) }
    assertEquals("failed", e.message)
    assertEquals(7_000L, testScheduler.currentTime)
  }

  @Test fun onceTheHubHasAnsweredALaterNoKeyEndsTheRunInsteadOfMixingServices() = runTest {
    val hub = FakeHub(reply(), AiHubException(Kinds.NO_KEY, "no key"), AiHubException(Kinds.TOO_LARGE, "big"), AiHubException(Kinds.NOT_ALLOWED, "off"))
    val own = FakeOwn()
    val provider = first(hub, own)
    provider.step(history, tools)
    val kinds = listOf(ProviderError.Kind.AUTH, ProviderError.Kind.BAD_REQUEST, ProviderError.Kind.AUTH)
    for (k in kinds) assertEquals(k, failure { provider.step(history, tools) }.kind)
    assertEquals(0, own.calls)
  }

  @Test fun aReplyWithoutTheRawMessageIsAnErrorNotARebuiltOneNorASecondRequest() = runTest {
    val own = FakeOwn()
    val sources = mutableListOf<String>()
    val noRaw = """{"text":"x","toolCalls":[],"usage":{"inputTokens":1,"cachedTokens":0,"outputTokens":1},"model":"m","service":"gemini"}"""
    val e = failure { first(FakeHub(noRaw), own, sources = sources).step(history, tools) }
    assertEquals(ProviderError.Kind.SERVER, e.kind)
    assertEquals(0, own.calls)
    assertTrue(sources.isEmpty())
    failure { first(FakeHub("not json"), own).step(history, tools) }
  }

  @Test fun noRequestCarriesAKeyOrAnAddress() = runTest {
    val hub = FakeHub(reply())
    first(hub).step(history, tools)
    val text = hub.requests.single().toString().lowercase()
    for (w in listOf("authorization", "bearer", "api_key", "googleapis", "groq.com", "baseurl")) assertFalse(w, w in text)
    assertEquals(setOf("apiVersion", "requestId", "job", "priority", "messages", "tools", "toolChoice", "maxTokens", "service"), hub.requests.single().keys)
    assertTrue(JsonArray(emptyList()).isEmpty())
  }
}
