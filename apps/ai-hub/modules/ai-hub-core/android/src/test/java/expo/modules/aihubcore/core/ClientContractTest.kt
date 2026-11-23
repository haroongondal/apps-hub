package expo.modules.aihubcore.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

// packages/ai-hub-client builds these requests and parses these replies; if either side drifts, one of the two test suites fails.
class ClientContractTest {
  private val fixture = Json.parseToJsonElement(File("../../../../../packages/ai-hub-client/fixtures/contract.json").readText()).jsonObject
  private val requests = fixture["requests"]!!.jsonObject
  private val replies = fixture["replies"]!!.jsonObject

  private fun parse(name: String) = Request.parse(requests[name]!!.toString())

  @Test fun theHubAcceptsEveryRequestTheClientBuilds() {
    val chat = parse("chat")
    assertEquals(listOf(Job.CHAT, 300, "look"), listOf(chat.job, chat.maxTokens, chat.tools.single().name))
    assertEquals(listOf(Job.VISION, "image/jpeg"), parse("vision").let { listOf(it.job, it.mime) })
    assertEquals(listOf(listOf("a", "b"), null), parse("embed").let { listOf(it.texts, it.dimensions) })
    assertEquals(768, parse("embedDimensions").dimensions)
    assertEquals(listOf("note.m4a", "audio/mp4", false), parse("transcribe").let { listOf(it.fileName, it.mime, it.segments) })
    assertEquals(true, parse("transcribeSegments").segments)
  }

  @Test fun theHubWritesTheRepliesTheClientParses() {
    val turn = ModelTurn(
      Msgs.user("x"),
      listOf(ToolCall("c1", "look", JsonObject(mapOf("q" to JsonPrimitive("a"))))),
      TokenUsage(10, 2, 5),
      "hello",
      ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite"),
    )
    assertEquals(replies["chat"], Json.parseToJsonElement(Results.chat(turn)))
    val b64 = { b: ByteArray -> java.util.Base64.getEncoder().encodeToString(b) }
    assertEquals(replies["embed"], Json.parseToJsonElement(Results.embed(listOf(floatArrayOf(0.5f, 1f), floatArrayOf(-2f, 0.25f)), "gemini-embedding-001", b64)))
    assertEquals(replies["transcribe"], Json.parseToJsonElement(Results.transcribe(Transcript("hi"))))
    val timed = Transcript("hi there", listOf(Segment(0.5, 1.5, "hi"), Segment(1.5, 2.25, " there")))
    assertEquals(replies["transcribeSegments"], Json.parseToJsonElement(Results.transcribe(timed)))
  }
}
