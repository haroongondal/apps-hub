package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

class KeyRingTest {
  @Test fun aSuccessIsSuccess() = assertEquals(Verdict.SUCCESS, verdictOf(HttpReply(200, "{}")))

  @Test fun aRefusedOrLimitedKeyHandsOver() {
    for (code in listOf(401, 403, 429)) assertEquals("$code", Verdict.NEXT_KEY, verdictOf(HttpReply(code, "")))
    assertEquals(Verdict.NEXT_KEY, verdictOf(HttpReply(400, """{"error":{"message":"API key not valid. Please pass a valid API key."}}""")))
    assertEquals(Verdict.NEXT_KEY, verdictOf(HttpReply(400, """{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}""")))
  }

  @Test fun anythingElseStops() {
    for (r in listOf(HttpReply(400, """{"error":"bad body"}"""), HttpReply(500, ""), HttpReply(503, ""), HttpReply(404, ""))) {
      assertEquals("${r.code}", Verdict.STOP, verdictOf(r))
    }
  }

  @Test fun aLimitBeatsARefusal() {
    assertEquals(Exhausted.LIMITED, exhausted(anyLimited = true))
    assertEquals(Exhausted.REFUSED, exhausted(anyLimited = false))
  }

  @Test fun keysAreGroupedByServiceTrimmedAndDeduplicated() {
    val ring = KeyRing(listOf(" gsk_a ", "AIza1", "AQ.2", "gsk_b", "gsk_a", "sk-unknown", ""))
    assertEquals(listOf("gsk_a", "gsk_b"), ring.keys(Service.GROQ))
    assertEquals(listOf("AIza1", "AQ.2"), ring.keys(Service.GEMINI))
    assertEquals(4, ring.all.size)
  }

  @Test fun theKeyInUseIsTriedFirstAndPerService() {
    val ring = KeyRing(listOf("gsk_a", "gsk_b", "gsk_c", "AIza1", "AIza2"))
    assertEquals(listOf(0, 1, 2), ring.order(Service.GROQ))
    ring.use(Service.GROQ, 2)
    assertEquals(listOf(2, 0, 1), ring.order(Service.GROQ))
    assertEquals(listOf(0, 1), ring.order(Service.GEMINI))
    assertEquals(emptyList<Int>(), KeyRing(emptyList()).order(Service.GROQ))
  }

  @Test fun theKeyInUseSticksAcrossJobsWithInterleavedKeys() {
    val stored = listOf("AIza1", "gsk_a", "AIza2")
    val replies = ArrayDeque(listOf(HttpReply(429, ""), HttpReply(200, """{"data":[{"index":0,"embedding":[1]}]}"""), HttpReply(200, """{"data":[{"index":0,"embedding":[1]}]}""")))
    val used = mutableListOf<String>()
    val transport = Transport { _, headers, _, _ -> used += headers.getValue("Authorization").removePrefix("Bearer "); replies.removeFirst() }
    val first = KeyRing(stored)
    Provider(first, transport) {}.embed(Job.EMBED.default, listOf("a"))
    val second = first.reuseFor(stored.toList())
    Provider(second, transport) {}.embed(Job.EMBED.default, listOf("a"))
    assertSame(first, second)
    assertEquals(listOf("AIza1", "AIza2", "AIza2"), used)
  }

  @Test fun changedKeysBuildANewRing() {
    val ring = KeyRing(listOf("AIza1", "AIza2")).apply { use(Service.GEMINI, 1) }
    val next = ring.reuseFor(listOf("AIza1", "AIza2", "AIza3"))
    assertNotSame(ring, next)
    assertEquals(0, next.current(Service.GEMINI))
  }
}
