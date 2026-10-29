package expo.modules.deputyagent.core

import java.io.IOException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class OpenAiCompatProviderTest {
  private val ok = HttpReply(200, """{"choices":[{"message":{"role":"assistant","content":"done"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}""")
  private val history = listOf(Msgs.user("T"))

  private class FakeHttp(vararg replies: Any) {
    val queue = ArrayDeque(replies.toList())
    val calls = mutableListOf<Triple<String, Map<String, String>, String>>()
    suspend fun post(url: String, headers: Map<String, String>, body: String): HttpReply {
      calls += Triple(url, headers, body)
      return when (val r = queue.removeFirst()) {
        is HttpReply -> r
        is IOException -> throw r
        else -> error("bad fixture")
      }
    }
  }

  private fun provider(http: FakeHttp, key: String = "sk-secret") =
    OpenAiCompatProvider("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.8-flash", key, null, http::post)

  private suspend fun failure(block: suspend () -> Unit): ProviderError {
    try {
      block()
    } catch (e: ProviderError) {
      return e
    }
    fail("expected a ProviderError")
    throw AssertionError()
  }

  @Test fun postsToChatCompletionsWithABearerKey() = runTest {
    val http = FakeHttp(ok)
    assertEquals("done", provider(http).step(history, emptyList()).text)
    val (url, headers) = http.calls.single()
    assertEquals("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", url)
    assertEquals("Bearer sk-secret", headers["Authorization"])
  }

  @Test fun rateLimitsAndServerErrorsBackOffOneTwoFourSeconds() = runTest {
    val http = FakeHttp(HttpReply(429, ""), HttpReply(500, ""), HttpReply(503, ""), ok)
    provider(http).step(history, emptyList())
    assertEquals(4, http.calls.size)
    assertEquals(7_000L, testScheduler.currentTime)
  }

  @Test fun aRateLimitWaitsAsLongAsTheServerSaysUpToAMinute() = runTest {
    val http = FakeHttp(HttpReply(429, "", retryAfterMs = 20_000), HttpReply(429, "", retryAfterMs = 3_600_000), ok)
    provider(http).step(history, emptyList())
    assertEquals(80_000L, testScheduler.currentTime)
  }

  @Test fun aMalformedToolCallIsRetried() = runTest {
    val http = FakeHttp(HttpReply(400, """{"error":{"code":"tool_use_failed","failed_generation":"tap(9"}}"""), ok)
    provider(http).step(history, emptyList())
    assertEquals(2, http.calls.size)
  }

  @Test fun aFourthServerErrorFails() = runTest {
    val e = failure { provider(FakeHttp(HttpReply(500, ""), HttpReply(500, ""), HttpReply(500, ""), HttpReply(500, ""))).step(history, emptyList()) }
    assertEquals(ProviderError.Kind.SERVER, e.kind)
  }

  @Test fun authErrorsPointAtTheKeyAndAreNotRetried() = runTest {
    val http = FakeHttp(HttpReply(401, ""))
    val e = failure { provider(http).step(history, emptyList()) }
    assertEquals(ProviderError.Kind.AUTH, e.kind)
    assertTrue(e.message, e.message!!.contains("API key"))
    assertEquals(1, http.calls.size)
  }

  @Test fun aBadRequestKeepsTheBodyButNeverTheKey() = runTest {
    val e = failure { provider(FakeHttp(HttpReply(400, "invalid key sk-secret for model"))).step(history, emptyList()) }
    assertEquals(ProviderError.Kind.BAD_REQUEST, e.kind)
    assertTrue(e.message, e.message!!.contains("invalid key"))
    assertFalse(e.message, e.message!!.contains("sk-secret"))
  }

  @Test fun networkLossRetriesThenReportsOffline() = runTest {
    val http = FakeHttp(IOException("a"), IOException("b"), IOException("c"), IOException("d"))
    assertEquals(ProviderError.Kind.OFFLINE, failure { provider(http).step(history, emptyList()) }.kind)
    assertEquals(4, http.calls.size)
    assertEquals(7_000L, testScheduler.currentTime)
  }

  @Test fun aDroppedConnectionIsRetried() = runTest {
    val http = FakeHttp(IOException("reset"), ok)
    assertEquals("done", provider(http).step(history, emptyList()).text)
    assertEquals(2, http.calls.size)
  }

  @Test fun aMissingKeyFailsBeforeAnyRequest() = runTest {
    val http = FakeHttp()
    assertEquals(ProviderError.Kind.AUTH, failure { provider(http, key = "").step(history, emptyList()) }.kind)
    assertEquals(0, http.calls.size)
  }
}
