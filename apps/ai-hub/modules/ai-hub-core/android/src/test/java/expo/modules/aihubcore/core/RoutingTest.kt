package expo.modules.aihubcore.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutingTest {
  private val defaults = Job.entries.associateWith { it.default }
  private val shot = """{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,QUJD"}}"""

  private fun chat(version: Int, messages: String = """[{"role":"user","content":"Hi"}]""", extra: String = "", job: String = "chat") =
    Request.parse("""{"apiVersion":$version,"requestId":"r","job":"$job","priority":"foreground","messages":$messages${if (job == "vision") ""","mime":"image/png"""" else ""}$extra}""")

  @Test fun aPlainChatRunsOnTheOwnersChoiceAndMayFallBack() {
    assertEquals(Route(Job.CHAT.default, true), routeFor(chat(3), defaults))
    assertEquals(Route(Job.CHAT.default, true), routeFor(chat(2), defaults))
  }

  @Test fun aV3ChatWithAPictureRunsOnTheVisionModelAndNeverFallsBack() {
    val shots = """[{"role":"user","content":[{"type":"text","text":"obs"},$shot]}]"""
    assertEquals(Route(Job.VISION.default, false), routeFor(chat(3, shots), defaults))
    // Before v3 the same request went where it always went.
    assertEquals(Route(Job.CHAT.default, true), routeFor(chat(2, shots), defaults))
  }

  @Test fun aSignedHistoryGoesBackToGemini() {
    val signed = """[{"role":"user","content":"T"},{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"tap","arguments":"{}"},"extra_content":{"google":{}}}]}]"""
    assertEquals(Route(Job.VISION.default, false), routeFor(chat(3, signed), defaults))
  }

  @Test fun theCallerCanPinTheServiceAndThenNothingFallsBack() {
    assertEquals(Route(Job.VISION.default, false), routeFor(chat(3, extra = ""","service":"gemini""""), defaults))
    assertEquals(Route(Job.CHAT.default, false), routeFor(chat(3, extra = ""","service":"groq""""), defaults))
    val ownerOnGemini = defaults + (Job.CHAT to ModelChoice(Service.GEMINI, "owner-pick"))
    assertEquals(Route(Job.CHAT.default, false), routeFor(chat(3, extra = ""","service":"groq""""), ownerOnGemini))
    assertEquals(Route(ModelChoice(Service.GROQ, "owner-groq"), false), routeFor(chat(3, extra = ""","service":"groq""""), defaults + (Job.CHAT to ModelChoice(Service.GROQ, "owner-groq"))))
  }

  @Test fun theVisionJobKeepsTheVisionModel() {
    assertEquals(Route(Job.VISION.default, true), routeFor(chat(3, job = "vision"), defaults))
  }

  @Test fun versionThreeRepliesCarryTheRawAssistantMessageAndTheService() {
    val assistant =
      """{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"tap","arguments":"{\"index\":9}"},""" +
        """"extra_content":{"google":{"thought_signature":"c2lnbmF0dXJl"}}}],"reasoning_details":[{"type":"x"}]}"""
    val turn = ProviderJson.parseChat("""{"choices":[{"message":$assistant}],"usage":{"prompt_tokens":5,"completion_tokens":2}}""", Job.VISION.default)
    val v3 = Json.parseToJsonElement(Results.chat(turn, 3)).jsonObject
    assertEquals(assistant, v3["raw"].toString())
    assertEquals("gemini", v3["service"]!!.jsonPrimitive.content)
    val v2 = Json.parseToJsonElement(Results.chat(turn, 2)).jsonObject
    assertEquals(setOf("text", "toolCalls", "usage", "model"), v2.keys)
    assertEquals(v2, Json.parseToJsonElement(Results.chat(turn)).jsonObject)
    assertTrue(v3.keys.containsAll(v2.keys))
    assertFalse(v2.containsKey("raw"))
  }
}
