package expo.modules.deputyagent.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderJsonTest {
  private val tap = ToolSpec("tap", "Tap an element", Json.parseToJsonElement("""{"type":"object","properties":{"index":{"type":"integer"}}}""").jsonObject)

  // Gemini 3 puts its thought signature in an extra field; it must come back byte for byte (SPEC §9.3).
  private val assistant =
    """{"role":"assistant","content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"tap","arguments":"{\"index\":9}"},""" +
      """"extra_content":{"google":{"thought_signature":"c2lnbmF0dXJl"}}}],"x_unknown":{"a":[1,2.5,"z"]}}"""
  private val response = """{"choices":[{"index":0,"message":$assistant,"finish_reason":"tool_calls"}],""" +
    """"usage":{"prompt_tokens":1200,"completion_tokens":80,"total_tokens":1280,"prompt_tokens_details":{"cached_tokens":1000}}}"""

  @Test fun requestHasModelMessagesToolsAndRequiredChoice() {
    val body = Json.parseToJsonElement(ProviderJson.request("gemini-3.8-flash", listOf(Msgs.system("S"), Msgs.user("T")), listOf(tap), "low")).jsonObject
    assertEquals("gemini-3.8-flash", body["model"]!!.jsonPrimitive.content)
    assertEquals("required", body["tool_choice"]!!.jsonPrimitive.content)
    assertEquals("low", body["reasoning_effort"]!!.jsonPrimitive.content)
    assertEquals("""{"role":"system","content":"S"}""", body["messages"]!!.jsonArray[0].toString())
    assertEquals("""{"role":"user","content":"T"}""", body["messages"]!!.jsonArray[1].toString())
    val fn = body["tools"]!!.jsonArray[0].jsonObject
    assertEquals("function", fn["type"]!!.jsonPrimitive.content)
    assertEquals("tap", fn["function"]!!.jsonObject["name"]!!.jsonPrimitive.content)
    assertEquals(tap.parameters, fn["function"]!!.jsonObject["parameters"])
  }

  @Test fun reasoningEffortIsLeftOutWhenNotSet() =
    assertFalse(ProviderJson.request("m", listOf(Msgs.user("T")), emptyList(), null).contains("reasoning_effort"))

  // Groq refuses unknown fields on a replayed message, so only the standard ones go back; tool calls keep theirs.
  @Test fun anAssistantMessageIsReplayedWithItsToolCallsVerbatimButNoUnknownFields() {
    val turn = ProviderJson.parse(response)
    val replayed = assistant.replace(""","x_unknown":{"a":[1,2.5,"z"]}""", "")
    assertEquals(replayed, turn.raw.json.toString())
    val next = ProviderJson.request("m", listOf(Msgs.user("T"), turn.raw, Msgs.tool("c1", "ok")), emptyList(), null)
    assertTrue(next, next.contains(replayed))
  }

  @Test fun parsesToolCallsUsageAndText() {
    val turn = ProviderJson.parse(response)
    assertEquals(listOf(ToolCall("c1", "tap", buildJsonObject { put("index", 9) })), turn.toolCalls)
    assertEquals(Usage(inputTokens = 1200, cachedTokens = 1000, outputTokens = 80), turn.usage)
    assertEquals(null, turn.text)
  }

  @Test fun missingCacheDetailsCountAsNoCachedTokens() {
    val turn = ProviderJson.parse("""{"choices":[{"message":{"role":"assistant","content":"hi"}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}""")
    assertEquals(Usage(5, 0, 2), turn.usage)
    assertEquals("hi", turn.text)
    assertEquals(emptyList<ToolCall>(), turn.toolCalls)
  }

  @Test fun aToolNameCarryingLeakedChannelSyntaxIsReadAsTheTool() {
    // GPT-OSS on Groq, 0.2.1 phone test: four turns lost to these names before the run gave up.
    val names = listOf("intent=functions.finish", "c=functions.finish", "tap").map { n ->
      ProviderJson.parse("""{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"$n","arguments":"{}"}}]}}]}""")
        .toolCalls.single().name
    }
    assertEquals(listOf("finish", "finish", "tap"), names)
  }

  @Test fun argumentsThatAreNotJsonBecomeAnEmptyObject() {
    val turn = ProviderJson.parse(
      """{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"tap","arguments":"{oops"}}]}}]}""",
    )
    assertEquals(JsonObject(emptyMap()), turn.toolCalls.single().args)
  }

  @Test fun aScreenshotRidesInAUserMessageAsADataUri() = assertEquals(
    """{"role":"user","content":[{"type":"text","text":"obs"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,AAA"}}]}""",
    Msgs.user("obs", jpegBase64 = "AAA").json.toString(),
  )

  @Test fun aToolResultNamesItsCall() = assertEquals(
    JsonObject(mapOf("role" to JsonPrimitive("tool"), "tool_call_id" to JsonPrimitive("c1"), "content" to JsonPrimitive("ok"))),
    Msgs.tool("c1", "ok").json,
  )
}
