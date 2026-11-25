package expo.modules.aihubcore.core

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ProviderTest {
  private val g1 = "gsk_aaaa1111"
  private val g2 = "gsk_bbbb2222"
  private val m1 = "AIzacccc3333"
  private val m2 = "AIzadddd4444"
  private val groqChat = Job.CHAT.default
  private val geminiChat = ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite")
  private val ok = HttpReply(200, """{"choices":[{"message":{"role":"assistant","content":"done"}}],"usage":{"prompt_tokens":120,"prompt_tokens_details":{"cached_tokens":20},"completion_tokens":7}}""")
  private val history = listOf(Msgs.user("T"))

  private class Call(val url: String, val headers: Map<String, String>, val body: ByteArray, val contentType: String) {
    val text get() = String(body)
    val key get() = headers["Authorization"]!!.removePrefix("Bearer ")
  }

  private class Fake(vararg replies: Any) {
    val queue = ArrayDeque(replies.toList())
    val calls = mutableListOf<Call>()
    val sleeps = mutableListOf<Long>()
    val transport = Transport { url, headers, body, contentType ->
      calls += Call(url, headers, body, contentType)
      when (val r = queue.removeFirst()) {
        is HttpReply -> r
        is IOException -> throw r
        else -> error("bad fixture")
      }
    }
    val keysUsed get() = calls.map { it.key }
  }

  private fun provider(http: Fake, vararg keys: String) = Provider(KeyRing(keys.toList()), http.transport, http.sleeps::add)

  private fun failure(block: () -> Unit): AiError {
    try {
      block()
    } catch (e: AiError) {
      return e
    }
    fail("expected an AiError")
    throw AssertionError()
  }

  @Test fun groqChatPostsToChatCompletionsWithABearerKey() {
    val http = Fake(ok)
    val turn = provider(http, g1).chat(groqChat, history, maxTokens = 500, reasoningEffort = "low")
    assertEquals("done", turn.text)
    assertEquals(TokenUsage(120, 20, 7), turn.usage)
    assertEquals(groqChat, turn.served)
    val call = http.calls.single()
    assertEquals("https://api.groq.com/openai/v1/chat/completions", call.url)
    assertEquals("Bearer $g1", call.headers["Authorization"])
    assertEquals("application/json", call.contentType)
    val body = Json.parseToJsonElement(call.text).jsonObject
    assertEquals("openai/gpt-oss-120b", body["model"]!!.jsonPrimitive.content)
    assertEquals(500, body["max_completion_tokens"]!!.jsonPrimitive.content.toInt())
    assertEquals("low", body["reasoning_effort"]!!.jsonPrimitive.content)
    assertNull(body["max_tokens"])
    assertNull(body["tools"])
  }

  @Test fun geminiGetsMaxTokensAndNoReasoningEffort() {
    val http = Fake(ok)
    provider(http, m1).chat(geminiChat, history, maxTokens = 500, reasoningEffort = "low")
    val call = http.calls.single()
    assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", call.url)
    val body = Json.parseToJsonElement(call.text).jsonObject
    assertEquals(500, body["max_tokens"]!!.jsonPrimitive.content.toInt())
    assertNull(body["max_completion_tokens"])
    assertNull(body["reasoning_effort"])
  }

  @Test fun aRefusedOrLimitedKeyHandsOverAtOnceAndTheNextCallStaysOnTheKeyThatWorked() {
    for (code in listOf(401, 403, 429)) {
      val http = Fake(HttpReply(code, "", retryAfterMs = 20_000), ok, ok)
      val p = provider(http, g1, g2)
      p.chat(groqChat, history, maxTokens = 100)
      p.chat(groqChat, history, maxTokens = 100)
      assertEquals("$code", listOf(g1, g2, g2), http.keysUsed)
      assertTrue("$code", http.sleeps.isEmpty())
    }
  }

  @Test fun geminiAnswering400ForAnUnknownKeyCountsAsRefused() {
    val http = Fake(HttpReply(400, """{"error":{"message":"API key not valid. Please pass a valid API key."}}"""), ok)
    provider(http, m1, m2).chat(geminiChat, history, maxTokens = 100)
    assertEquals(listOf(m1, m2), http.keysUsed)
  }

  @Test fun anOrdinary400StopsWithoutTryingAnotherKeyAndNeverShowsAKey() {
    val http = Fake(HttpReply(400, """{"error":"$g1 and $g2 are invalid for model"}"""), ok)
    val e = failure { provider(http, g1, g2).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.BAD_REQUEST, e.kind)
    assertEquals(400, e.httpCode)
    assertEquals(Service.GROQ, e.service)
    assertFalse(e.fellBack)
    assertTrue(e.message, e.message!!.contains("are invalid for model"))
    assertFalse(e.message, e.message!!.contains(g1) || e.message!!.contains(g2))
    assertEquals(1, http.calls.size)
  }

  @Test fun aServerErrorStopsWithoutTryingAnotherKeyOrService() {
    val http = Fake(HttpReply(500, ""), ok)
    val e = failure { provider(http, g1, g2, m1).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals("Groq is busy or failing (HTTP 500). Try again later.", e.message)
    assertEquals(1, http.calls.size)
    assertTrue(http.sleeps.isEmpty())
  }

  @Test fun aGatewayTimeoutIsATimeoutAndIsNotResent() {
    for (code in listOf(504, 524)) {
      val http = Fake(HttpReply(code, "gateway timeout"), ok)
      assertEquals(AiError.Kind.TIMEOUT, failure { provider(http, g1, g2).chat(groqChat, history, maxTokens = 100) }.kind)
      assertEquals(1, http.calls.size)
    }
  }

  @Test fun everyKeyRefusedFailsAtOnceWithoutWaiting() {
    val http = Fake(HttpReply(401, ""), HttpReply(403, ""))
    val e = failure { provider(http, g1, g2).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.AUTH, e.kind)
    assertEquals("Groq refused every key (HTTP 403). Check your Groq keys in AI hub.", e.message)
    assertTrue(http.sleeps.isEmpty())
  }

  @Test fun aLimitBeatsARefusalSoTheLimitedKeyIsWaitedFor() {
    val http = Fake(HttpReply(401, ""), HttpReply(429, "", retryAfterMs = 5_000), ok)
    provider(http, g1, g2).chat(groqChat, history, maxTokens = 100)
    assertEquals(listOf(5_000L), http.sleeps)
    assertEquals("the refused key is not tried again", listOf(g1, g2, g2), http.keysUsed)
  }

  @Test fun everyKeyLimitedWaitsForTheFirstToComeFreeCappedAtAMinute() {
    val http = Fake(HttpReply(429, "", retryAfterMs = 3_600_000), HttpReply(429, "", retryAfterMs = 3_600_000), ok)
    provider(http, g1, g2).chat(groqChat, history, maxTokens = 100)
    assertEquals(listOf(60_000L), http.sleeps)
    assertEquals(listOf(g1, g2, g1), http.keysUsed)
  }

  @Test fun aRateLimitWaitUsesGeminisBodyHintOrTenSeconds() {
    val hinted = """[{"error":{"code":429,"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37.5s"}]}}]"""
    val http = Fake(HttpReply(429, hinted), HttpReply(429, ""), HttpReply(200, """{"data":[{"index":0,"embedding":[1]}]}"""))
    assertEquals(1, provider(http, m1).embed(Job.EMBED.default, listOf("a")).size)
    assertEquals(listOf(37_500L, 10_000L), http.sleeps)
  }

  @Test fun everyKeyLimitedOnEveryRoundEndsAsARateLimitAfterTwoWaits() {
    val http = Fake(*Array(6) { HttpReply(429, "", retryAfterMs = 1_000) })
    val e = failure { provider(http, g1, g2).transcribe(Job.TRANSCRIBE.default, byteArrayOf(1), "a.m4a", "audio/mp4") }
    assertEquals(AiError.Kind.RATE, e.kind)
    assertEquals("Every Groq key is at its rate limit. Wait a minute and try again, or add another key in AI hub.", e.message)
    assertEquals(6, http.calls.size)
    assertEquals(listOf(1_000L, 1_000L), http.sleeps)
  }

  @Test fun aReadTimeoutIsNeverResent() {
    val http = Fake(SocketTimeoutException("Read timed out"), ok)
    val e = failure { provider(http, g1, g2).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.TIMEOUT, e.kind)
    assertEquals("Groq took too long to answer. Try again later.", e.message)
    assertEquals(1, http.calls.size)
    assertTrue(http.sleeps.isEmpty())
  }

  @Test fun aConnectFailureIsRetriedWithBackoffThenReportsOffline() {
    val http = Fake(IOException("a"), IOException("b"), IOException("c"), IOException("d"))
    val e = failure { provider(http, g1).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.OFFLINE, e.kind)
    assertEquals("AI hub couldn't reach Groq. Check the phone's connection and try again.", e.message)
    assertEquals(4, http.calls.size)
    assertEquals(listOf(1_000L, 2_000L, 4_000L), http.sleeps)
  }

  @Test fun aRequestThatNeverConnectedIsRetried() {
    val http = Fake(ConnectException("Connection refused"), ok)
    assertEquals("done", provider(http, g1).chat(groqChat, history, maxTokens = 100).text)
    assertEquals(2, http.calls.size)
    assertEquals(listOf(1_000L), http.sleeps)
  }

  @Test fun aRateErrorCarriesTheServersRetryAfter() {
    val http = Fake(*Array(3) { HttpReply(429, "", retryAfterMs = 30_000) })
    val e = failure { provider(http, m1).embed(Job.EMBED.default, listOf("a")) }
    assertEquals(AiError.Kind.RATE, e.kind)
    assertEquals(30_000L, e.retryAfterMs)
  }

  @Test fun aToolCallGroqCouldNotParseIsRetriedOnce() {
    val bad = HttpReply(400, """{"error":{"code":"tool_use_failed","failed_generation":"tap(9"}}""")
    assertEquals("done", provider(Fake(bad, ok), g1).chat(groqChat, history, maxTokens = 100).text)
    val twice = Fake(bad, bad, ok)
    assertEquals(AiError.Kind.BAD_REQUEST, failure { provider(twice, g1).chat(groqChat, history, maxTokens = 100) }.kind)
    assertEquals(2, twice.calls.size)
  }

  @Test fun aFailureRecordsTheServiceTheStatusAndWhetherTheOtherServiceWasTried() {
    val http = Fake(HttpReply(401, ""), HttpReply(413, "too large"))
    val e = failure { provider(http, g1, m1).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.BAD_REQUEST, e.kind)
    assertEquals(Service.GEMINI, e.service)
    assertEquals(413, e.httpCode)
    assertTrue("Gemini was tried after Groq refused the key", e.fellBack)
    val server = failure { provider(Fake(HttpReply(503, "")), g1).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.SERVER, server.kind)
    assertEquals(503, server.httpCode)
    assertFalse(server.fellBack)
  }

  @Test fun chatFallsBackToGeminiWhenEveryGroqKeyIsRefusedOrLimited() {
    for (out in listOf(HttpReply(401, ""), HttpReply(429, ""))) {
      val http = Fake(out, out, ok)
      val turn = provider(http, g1, g2, m1).chat(groqChat, history, maxTokens = 300, reasoningEffort = "low")
      assertEquals(Job.CHAT.fallback, turn.served)
      assertEquals(listOf(g1, g2, m1), http.keysUsed)
      assertTrue(http.sleeps.isEmpty())
      val last = http.calls.last()
      assertTrue(last.url.startsWith(Service.GEMINI.baseUrl))
      val body = Json.parseToJsonElement(last.text).jsonObject
      assertEquals("gemini-3.5-flash-lite", body["model"]!!.jsonPrimitive.content)
      assertEquals(300, body["max_tokens"]!!.jsonPrimitive.content.toInt())
      assertNull(body["reasoning_effort"])
    }
  }

  @Test fun chatWithNoGroqKeyGoesStraightToGemini() {
    val http = Fake(ok)
    assertEquals(Job.CHAT.fallback, provider(http, m1).chat(groqChat, history, maxTokens = 100).served)
  }

  @Test fun bothServicesOutReportsBoth() {
    val http = Fake(HttpReply(401, ""), HttpReply(403, ""))
    val e = failure { provider(http, g1, m1).chat(groqChat, history, maxTokens = 100) }
    assertEquals("Groq and Gemini refused every key (HTTP 403). Check your Groq and Gemini keys in AI hub.", e.message)
  }

  @Test fun aChatWithAnImageNeverFallsBackToGroq() {
    val http = Fake(HttpReply(401, ""))
    val e = failure { provider(http, m1, g1).chat(geminiChat, listOf(Msgs.user("what is this", listOf("AAA"))), maxTokens = 100) }
    assertEquals(AiError.Kind.AUTH, e.kind)
    assertEquals(listOf(m1), http.keysUsed)
  }

  @Test fun embedNeverFallsBackToGroq() {
    val http = Fake(HttpReply(429, ""), HttpReply(429, ""), HttpReply(429, ""))
    assertEquals(AiError.Kind.RATE, failure { provider(http, m1, g1).embed(Job.EMBED.default, listOf("a")) }.kind)
    assertEquals(listOf(m1, m1, m1), http.keysUsed)
  }

  @Test fun noKeyForTheServiceFailsBeforeAnyRequest() {
    val http = Fake()
    val e = failure { provider(http, g1).embed(Job.EMBED.default, listOf("a")) }
    assertEquals(AiError.Kind.AUTH, e.kind)
    assertEquals("No Gemini key is set. Add one in AI hub.", e.message)
    assertEquals(0, http.calls.size)
  }

  @Test fun anEmbeddingReplyWithTheWrongCountIsLoggedAsHttp200WithItsShapeAndNoValues() {
    val http = Fake(HttpReply(200, """{"object":"list","data":[{"index":0,"embedding":[0.123]}],"model":"secret-looking-value"}"""))
    val e = failure { provider(http, m1).embed(Job.EMBED.default, listOf("a", "b", "c")) }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals(200, e.httpCode)
    assertEquals(Service.GEMINI, e.service)
    assertEquals("fields object,data,model, data 1 of 3 texts, item index,embedding, embedding array 1", e.detail)
    assertFalse(e.detail!!.contains("secret-looking-value") || e.detail!!.contains("0.123"))
  }

  @Test fun anEmbeddingItemThatIsNotANumberArrayIsLoggedByItsType() {
    val http = Fake(HttpReply(200, """{"data":[{"embedding":"AAAA"}],"model":"m"}"""))
    assertEquals("fields data,model, data 1 of 1 texts, item embedding, embedding not an array", failure { provider(http, m1).embed(Job.EMBED.default, listOf("a")) }.detail)
  }

  @Test fun embedKeepsInputOrderWhenTheReplyLeavesIndexOut() {
    val http = Fake(HttpReply(200, """{"data":[{"embedding":[1,0]},{"embedding":[0,1]}]}"""))
    val out = provider(http, m1).embed(Job.EMBED.default, listOf("a", "b"))
    assertArrayEquals(floatArrayOf(1f, 0f), out[0], 0f)
    assertArrayEquals(floatArrayOf(0f, 1f), out[1], 0f)
  }

  @Test fun aReplyThatIsNotJsonIsLoggedWithItsSizeOnly() {
    val http = Fake(HttpReply(200, "<html>oops</html>"))
    assertEquals("not JSON, 17 bytes", failure { provider(http, m1).embed(Job.EMBED.default, listOf("a")) }.detail)
  }

  @Test fun embedSendsModelAndInputAndReturnsVectorsInInputOrder() {
    val http = Fake(HttpReply(200, """{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0.5]}]}"""))
    val out = provider(http, m1).embed(Job.EMBED.default, listOf("a", "b"))
    assertArrayEquals(floatArrayOf(1f, 0.5f), out[0], 0f)
    assertArrayEquals(floatArrayOf(0f, 1f), out[1], 0f)
    val call = http.calls.single()
    assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/embeddings", call.url)
    assertEquals("""{"model":"gemini-embedding-001","input":["a","b"]}""", call.text)
  }

  @Test fun theWrongNumberOfEmbeddingsIsAnUnreadableReply() {
    val e = failure { provider(Fake(HttpReply(200, """{"data":[]}""")), m1).embed(Job.EMBED.default, listOf("a")) }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals("Gemini sent a reply AI hub couldn't read. Try again later.", e.message)
  }

  @Test fun transcribeUploadsAMultipartForm() {
    val http = Fake(HttpReply(200, """{"text":"hi there"}"""))
    val audio = byteArrayOf(0, 1, 2, -1)
    assertEquals(Transcript("hi there"), provider(http, g1).transcribe(Job.TRANSCRIBE.default, audio, "note.m4a", "audio/mp4"))
    val call = http.calls.single()
    assertEquals("https://api.groq.com/openai/v1/audio/transcriptions", call.url)
    assertTrue(call.contentType, call.contentType.startsWith("multipart/form-data; boundary="))
    val b = call.contentType.substringAfter("boundary=")
    val head = "--$b\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-large-v3-turbo\r\n" +
      "--$b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"note.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n"
    assertArrayEquals(head.toByteArray() + audio + "\r\n--$b--\r\n".toByteArray(), call.body)
  }

  @Test fun aCallersFileNameAndTypeCannotBreakOutOfTheirHeader() {
    val body = String(ProviderJson.multipart("B", emptyMap(), "a\"\r\nX: y.m4a", "audio/mp4\r\nX: y", byteArrayOf()))
    assertTrue(body, body.contains("filename=\"a___X: y.m4a\"\r\nContent-Type: application/octet-stream\r\n"))
  }

  @Test fun anUnreadableChatReplyIsAServerError() {
    val e = failure { provider(Fake(HttpReply(200, "<html>nope</html>")), g1).chat(groqChat, history, maxTokens = 100) }
    assertEquals(AiError.Kind.SERVER, e.kind)
  }

  private val tap = ToolSpec("tap", "Tap an element", Json.parseToJsonElement("""{"type":"object","properties":{"index":{"type":"integer"}}}""").jsonObject)

  @Test fun aRequestCarriesToolsAndTheCallersToolChoice() {
    val body = Json.parseToJsonElement(ProviderJson.chatRequest(groqChat, listOf(Msgs.system("S"), Msgs.user("T")), listOf(tap), 100, null, "required")).jsonObject
    assertEquals("required", body["tool_choice"]!!.jsonPrimitive.content)
    assertEquals("""{"role":"system","content":"S"}""", body["messages"]!!.jsonArray[0].toString())
    val fn = body["tools"]!!.jsonArray[0].jsonObject
    assertEquals("function", fn["type"]!!.jsonPrimitive.content)
    assertEquals(tap.parameters, fn["function"]!!.jsonObject["parameters"])
    assertNull(Json.parseToJsonElement(ProviderJson.chatRequest(groqChat, history, listOf(tap), 100, null, null)).jsonObject["tool_choice"])
  }

  @Test fun anAssistantMessageIsReplayedWithItsToolCallsButNoUnknownFields() {
    val assistant =
      """{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"tap","arguments":"{\"index\":9}"},""" +
        """"extra_content":{"google":{"thought_signature":"c2lnbmF0dXJl"}}}],"x_unknown":{"a":[1]}}"""
    val turn = ProviderJson.parseChat("""{"choices":[{"message":$assistant}],"usage":{"prompt_tokens":1200,"completion_tokens":80}}""", geminiChat)
    assertEquals(assistant.replace(""","x_unknown":{"a":[1]}""", ""), turn.raw.json.toString())
    assertEquals(listOf(ToolCall("c1", "tap", buildJsonObject { put("index", 9) })), turn.toolCalls)
    assertEquals(TokenUsage(1200, 0, 80), turn.usage)
    assertNull(turn.text)
  }

  @Test fun aToolNameWithLeakedChannelSyntaxAndBadArgumentsStillParses() {
    val names = listOf("intent=functions.finish", "tap").map { n ->
      ProviderJson.parseChat("""{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"$n","arguments":"{oops"}}]}}]}""", groqChat)
        .toolCalls.single()
    }
    assertEquals(listOf("finish", "tap"), names.map { it.name })
    assertEquals(JsonObject(emptyMap()), names[0].args)
  }

  @Test fun imagesRideInAUserMessageAsJpegDataUrls() {
    val msg = Msgs.user("obs", listOf("AAA", "BBB"))
    assertEquals(
      """{"role":"user","content":[{"type":"text","text":"obs"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,AAA"}},""" +
        """{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,BBB"}}]}""",
      msg.json.toString(),
    )
    assertTrue(msg.hasImage)
    assertFalse(Msgs.user("plain").hasImage)
  }

  @Test fun embedSendsDimensionsOnlyWhenAsked() {
    val http = Fake(HttpReply(200, """{"data":[{"index":0,"embedding":[1,0]}]}"""))
    provider(http, m1).embed(Job.EMBED.default, listOf("a"), 768)
    assertEquals("""{"model":"gemini-embedding-001","input":["a"],"dimensions":768}""", http.calls.single().text)
  }

  @Test fun transcribeWithSegmentsAsksForVerboseJsonAndKeepsStartEndText() {
    val reply = """{"task":"transcribe","text":"hi there","segments":[{"id":0,"seek":0,"start":0.0,"end":1.5,"text":"hi","tokens":[1],"avg_logprob":-0.1},{"id":1,"start":1.5,"end":2.25,"text":" there"}]}"""
    val http = Fake(HttpReply(200, reply))
    val t = provider(http, g1).transcribe(Job.TRANSCRIBE.default, byteArrayOf(1), "note.m4a", "audio/mp4", segments = true)
    assertEquals(Transcript("hi there", listOf(Segment(0.0, 1.5, "hi"), Segment(1.5, 2.25, " there"))), t)
    val b = http.calls.single().contentType.substringAfter("boundary=")
    assertTrue(String(http.calls.single().body).contains("--$b\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\nverbose_json\r\n"))
  }

  @Test fun transcribeWithoutSegmentsLeavesTheFormatAlone() {
    val http = Fake(HttpReply(200, """{"text":"hi"}"""))
    provider(http, g1).transcribe(Job.TRANSCRIBE.default, byteArrayOf(1), "note.m4a", "audio/mp4")
    assertFalse(String(http.calls.single().body).contains("response_format"))
  }

  @Test fun segmentsMissingFromTheReplyIsAServerError() {
    val e = failure { provider(Fake(HttpReply(200, """{"text":"hi"}""")), g1).transcribe(Job.TRANSCRIBE.default, byteArrayOf(1), "a.m4a", "audio/mp4", segments = true) }
    assertEquals(AiError.Kind.SERVER, e.kind)
  }
}
