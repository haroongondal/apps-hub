package expo.modules.aihubclient.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class HubLimitsTest {
  // The same fixture the TypeScript builders and the hub's JVM tests use (gradle runs tests from the module's android/ folder).
  private val requests = Json.parseToJsonElement(File("../fixtures/contract.json").readText()).jsonObject["requests"]!!.jsonObject

  private fun req(name: String) = requests[name]!!.toString()

  private fun refused(kind: String, json: String, size: Long? = null) {
    try {
      HubLimits.check(json, size)
      fail("accepted ${json.take(120)}")
    } catch (e: AiHubException) {
      assertEquals(e.message, kind, e.kind)
    }
  }

  @Test fun everyFixtureRequestPassesWithItsAttachment() {
    assertEquals(Checked("chat-1", 1, "chat"), HubLimits.check(req("chat"), null))
    assertEquals(Checked("vision-1", 1, "vision"), HubLimits.check(req("vision"), 1_000))
    assertEquals(Checked("embed-1", 1, "embed"), HubLimits.check(req("embed"), null))
    assertEquals(Checked("embed-2", 2, "embed"), HubLimits.check(req("embedDimensions"), null))
    assertEquals(Checked("audio-1", 1, "transcribe"), HubLimits.check(req("transcribe"), 1_000))
    assertEquals(Checked("audio-2", 2, "transcribe"), HubLimits.check(req("transcribeSegments"), 1_000))
  }

  @Test fun requestJsonIsCountedInBytesNotCharacters() {
    val pad = { text: String -> """{"apiVersion":1,"requestId":"r","job":"chat","priority":"foreground","messages":[{"role":"user","content":"$text"}]}""" }
    val overhead = pad("").toByteArray().size
    HubLimits.check(pad("a".repeat(HubLimits.MAX_JSON_BYTES - overhead)), null)
    refused(Kinds.TOO_LARGE, pad("a".repeat(HubLimits.MAX_JSON_BYTES - overhead + 1)))
    // "é" is one character but two bytes.
    refused(Kinds.TOO_LARGE, pad("é".repeat((HubLimits.MAX_JSON_BYTES - overhead) / 2 + 1)))
  }

  @Test fun attachmentsAreCappedPerJob() {
    HubLimits.check(req("vision"), HubLimits.MAX_IMAGE_BYTES)
    refused(Kinds.TOO_LARGE, req("vision"), HubLimits.MAX_IMAGE_BYTES + 1)
    HubLimits.check(req("transcribe"), HubLimits.MAX_AUDIO_BYTES)
    refused(Kinds.TOO_LARGE, req("transcribe"), HubLimits.MAX_AUDIO_BYTES + 1)
    refused(Kinds.INVALID, req("vision"), null)
    refused(Kinds.INVALID, req("transcribe"), -1)
    refused(Kinds.INVALID, req("chat"), 10)
  }

  @Test fun embedTakesAtMostEightTexts() {
    val texts = { n: Int -> (1..n).joinToString(",") { "\"t$it\"" } }
    HubLimits.check("""{"apiVersion":1,"requestId":"e","job":"embed","priority":"background","texts":[${texts(8)}]}""", null)
    refused(Kinds.TOO_LARGE, """{"apiVersion":1,"requestId":"e","job":"embed","priority":"background","texts":[${texts(9)}]}""")
  }

  @Test fun malformedRequestsAreInvalid() {
    refused(Kinds.INVALID, "not json")
    refused(Kinds.INVALID, """{"apiVersion":1,"requestId":"a b","job":"chat"}""")
    refused(Kinds.INVALID, """{"requestId":"r","job":"chat"}""")
    refused(Kinds.INVALID, """{"apiVersion":"2","requestId":"r","job":"chat"}""")
    refused(Kinds.INVALID, """{"apiVersion":1,"requestId":"r","job":"draw"}""")
    assertNull(HubLimits.requestIdOf("""{"requestId":7}"""))
    assertEquals("chat-1", HubLimits.requestIdOf(req("chat")))
  }

  @Test fun hubErrorKindsMapToClientKinds() {
    val map = listOf("denied", "auth", "too_large", "invalid", "busy", "rate", "cancelled", "timeout", "bad_request", "server", "offline", "internal", null)
      .associateWith { Kinds.fromHub(it) }
    assertEquals(
      mapOf(
        "denied" to Kinds.NOT_ALLOWED, "auth" to Kinds.NO_KEY, "too_large" to Kinds.TOO_LARGE, "invalid" to Kinds.INVALID,
        "busy" to Kinds.BUSY, "rate" to Kinds.BUSY, "cancelled" to Kinds.CANCELLED, "timeout" to Kinds.TIMEOUT,
        "bad_request" to Kinds.PROVIDER, "server" to Kinds.PROVIDER, "offline" to Kinds.PROVIDER, "internal" to Kinds.PROVIDER, null to Kinds.PROVIDER,
      ),
      map,
    )
  }
}
