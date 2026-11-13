package expo.modules.inflowcore.core

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AiProviderTest {
  private val ok = HttpReply(200, """{"choices":[{"message":{"role":"assistant","content":"done"}}],"usage":{"prompt_tokens":120,"prompt_tokens_details":{"cached_tokens":20},"completion_tokens":7}}""")

  private class Fake(vararg replies: Any) {
    val queue = ArrayDeque(replies.toList())
    val calls = mutableListOf<Triple<String, Map<String, String>, String>>()
    val sleeps = mutableListOf<Long>()
    fun post(url: String, headers: Map<String, String>, body: String): HttpReply {
      calls += Triple(url, headers, body)
      return when (val r = queue.removeFirst()) {
        is HttpReply -> r
        is IOException -> throw r
        else -> error("bad fixture")
      }
    }
    val keysUsed get() = calls.map { it.second["Authorization"]!!.removePrefix("Bearer ") }
  }

  private fun provider(http: Fake, keys: List<String> = listOf("sk-secret"), effort: String? = null) =
    OpenAiCompatProvider("https://api.example.com/v1/", "m-1", keys, effort, http::post, http.sleeps::add)

  private fun failure(block: () -> Unit): AiError {
    try {
      block()
    } catch (e: AiError) {
      return e
    }
    fail("expected an AiError")
    throw AssertionError()
  }

  @Test fun postsSystemAndUserToChatCompletionsWithABearerKey() {
    val http = Fake(ok)
    val r = provider(http, effort = "low").complete("SYS", "USR")
    assertEquals("done", r.text)
    assertEquals(Usage(120, 20, 7), r.usage)
    val (url, headers, body) = http.calls.single()
    assertEquals("https://api.example.com/v1/chat/completions", url)
    assertEquals("Bearer sk-secret", headers["Authorization"])
    assertTrue(body, body.contains("\"model\":\"m-1\"") && body.contains("\"SYS\"") && body.contains("\"USR\"") && body.contains("\"reasoning_effort\":\"low\""))
    assertFalse(body, body.contains("tools"))
  }

  @Test fun authErrorPointsAtTheKeyAndIsNotRetried() {
    val http = Fake(HttpReply(401, ""))
    val e = failure { provider(http).complete("s", "u") }
    assertEquals(AiError.Kind.AUTH, e.kind)
    assertEquals("The model refused the API key (HTTP 401). Check your API key in Settings.", e.message)
    assertEquals(1, http.calls.size)
  }

  @Test fun rateLimitWithOneKeyBacksOffThenReportsIt() {
    val http = Fake(*Array(4) { HttpReply(429, "") })
    val e = failure { provider(http).complete("s", "u") }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals("The model's rate limit was reached (HTTP 429). Wait a minute, or check your plan's limits.", e.message)
    assertEquals(listOf(1_000L, 2_000L, 4_000L), http.sleeps)
  }

  @Test fun aKeyAtItsLimitHandsOverToTheNextAtOnce() {
    val http = Fake(HttpReply(429, "", retryAfterMs = 20_000), ok)
    provider(http, listOf("key-a", "key-b")).complete("s", "u")
    assertEquals(listOf("key-a", "key-b"), http.keysUsed)
    assertTrue(http.sleeps.isEmpty())
  }

  @Test fun everyKeyLimitedWaitsTheServersTimeCappedAtAMinute() {
    val http = Fake(HttpReply(429, "", retryAfterMs = 5_000), HttpReply(429, "", retryAfterMs = 3_600_000), ok)
    provider(http, listOf("key-a", "key-b")).complete("s", "u")
    assertEquals(listOf(60_000L), http.sleeps)
    assertEquals(listOf("key-a", "key-b", "key-b"), http.keysUsed)
  }

  @Test fun serverErrorsRetryThreeTimesThenFail() {
    val http = Fake(HttpReply(500, ""), HttpReply(502, ""), HttpReply(503, ""), HttpReply(500, ""))
    val e = failure { provider(http).complete("s", "u") }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals("The model is busy or failing (HTTP 500). Try again later.", e.message)
    assertEquals(4, http.calls.size)
    assertEquals(listOf(1_000L, 2_000L, 4_000L), http.sleeps)
  }

  @Test fun networkLossRetriesThenReportsOffline() {
    val http = Fake(IOException("a"), IOException("b"), IOException("c"), IOException("d"))
    val e = failure { provider(http).complete("s", "u") }
    assertEquals(AiError.Kind.OFFLINE, e.kind)
    assertEquals("Inflow couldn't reach the model. Check the phone's connection and try again.", e.message)
    assertEquals(4, http.calls.size)
  }

  @Test fun aDroppedConnectionIsRetriedOnce() {
    val http = Fake(IOException("reset"), ok)
    assertEquals("done", provider(http).complete("s", "u").text)
    assertEquals(2, http.calls.size)
  }

  @Test fun badRequestKeepsTheBodyButNeverAnyKey() {
    val e = failure { provider(Fake(HttpReply(400, "key-a and key-b are invalid for model")), listOf("key-a", "key-b")).complete("s", "u") }
    assertEquals(AiError.Kind.BAD_REQUEST, e.kind)
    assertTrue(e.message, e.message!!.contains("are invalid for model"))
    assertFalse(e.message, e.message!!.contains("key-a") || e.message!!.contains("key-b"))
  }

  @Test fun missingKeyFailsBeforeAnyRequest() {
    val http = Fake()
    val e = failure { provider(http, keys = emptyList()).complete("s", "u") }
    assertEquals(AiError.Kind.AUTH, e.kind)
    assertEquals("No API key is set. Add your API key in Settings.", e.message)
    assertEquals(0, http.calls.size)
  }

  @Test fun unreadableReplyIsAServerError() {
    val e = failure { provider(Fake(HttpReply(200, "<html>nope</html>"))).complete("s", "u") }
    assertEquals(AiError.Kind.SERVER, e.kind)
    assertEquals("The model sent a reply Inflow couldn't read.", e.message)
  }

  @Test fun knownModelsMatchByAddressAndModelIgnoringTrailingSlash() {
    assertEquals(3, AiModels.KNOWN.size)
    val groq = AiModels.known("https://api.groq.com/openai/v1", "openai/gpt-oss-20b")
    assertNotNull(groq)
    assertEquals(Prices(0.075, 0.037, 0.30), groq!!.prices)
    assertNull(AiModels.known("https://api.groq.com/openai/v1/", "other"))
  }

  @Test fun validationCopyMatchesDeputy() {
    val gemini = AiModels.KNOWN.first()
    assertNull(AiModels.validate(gemini.baseUrl, gemini.model, null))
    assertEquals("The address must start with https://, so the key never travels unencrypted.", AiModels.validate("http://x.com/v1", "m", null))
    assertEquals("Type the model's name, with no spaces.", AiModels.validate("https://x.com/v1", "my model", null))
    assertEquals(
      "Enter this model's prices. Inflow only knows the prices of ${AiModels.KNOWN.joinToString { it.name }}, and the cost limits are counted with them.",
      AiModels.validate("https://x.com/v1", "m", null),
    )
    assertNull(AiModels.validate("https://x.com/v1", "m", Prices(1.0, 0.0, 2.0)))
    assertEquals("The input price must be a number from 0.001 to 1000.", AiModels.validate("https://x.com/v1", "m", Prices(0.0, 0.0, 2.0)))
  }
}
