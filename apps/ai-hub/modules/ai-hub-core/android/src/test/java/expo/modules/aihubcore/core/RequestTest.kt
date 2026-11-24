package expo.modules.aihubcore.core

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.concurrent.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RequestTest {
  private val chatMessages = """[{"role":"system","content":"Be brief."},{"role":"user","content":"Hi"}]"""

  private fun json(job: String = "chat", extra: String = """"messages":$chatMessages""", id: String = "\"r1\"", version: String = "1", priority: String = "\"foreground\"") =
    """{"apiVersion":$version,"requestId":$id,"job":"$job","priority":$priority${if (extra.isEmpty()) "" else ",$extra"}}"""

  private fun rejects(text: String, words: String, id: String = "r1") {
    try {
      Request.parse(text)
      fail("accepted: ${text.take(200)}")
    } catch (e: BadRequest) {
      assertTrue("'${e.message}' lacks '$words'", e.message!!.contains(words))
      assertEquals(id, e.requestId)
    }
  }

  @Test fun validChat() {
    val r = Request.parse(json(extra = """"messages":$chatMessages,"tools":[{"name":"look","description":"d","parameters":{"type":"object"}}],"maxTokens":300"""))
    assertEquals(Job.CHAT, r.job)
    assertEquals(Priority.FOREGROUND, r.priority)
    assertEquals(listOf("system", "user"), r.messages.map { it.role })
    assertEquals("look", r.tools.single().name)
    assertEquals(300, r.maxTokens)
    assertNull(r.attachmentCap)
  }

  @Test fun chatDefaultsMaxTokens() {
    assertEquals(Request.DEFAULT_MAX_TOKENS, Request.parse(json()).maxTokens)
  }

  @Test fun validVision() {
    val r = Request.parse(json("vision", """"messages":$chatMessages,"mime":"image/png""""))
    assertEquals(Job.VISION, r.job)
    assertEquals("image/png", r.mime)
    assertEquals(7 * 1024 * 1024, r.attachmentCap)
  }

  @Test fun validEmbed() {
    val r = Request.parse(json("embed", """"texts":["a","b"]""", priority = "\"background\""))
    assertEquals(listOf("a", "b"), r.texts)
    assertEquals(Priority.BACKGROUND, r.priority)
  }

  @Test fun validTranscribe() {
    val r = Request.parse(json("transcribe", """"fileName":"note.m4a","mime":"audio/mp4""""))
    assertEquals("note.m4a", r.fileName)
    assertEquals(Request.MAX_AUDIO_BYTES, r.attachmentCap)
  }

  @Test fun rejectsNewerApiVersion() = rejects(json(version = "3"), "newer AI hub")

  @Test fun versionOneRequestsStillParseUnchanged() {
    val embed = Request.parse(json("embed", "\"texts\":[\"a\"]", version = "1"))
    assertNull(embed.dimensions)
    val audio = Request.parse(json("transcribe", "\"fileName\":\"n.m4a\",\"mime\":\"audio/mp4\"", version = "1"))
    assertEquals(false, audio.segments)
    assertEquals(Job.CHAT, Request.parse(json(version = "1")).job)
  }

  @Test fun embedDimensionsRoundUpToASizeGeminiDocuments() {
    fun dims(v: String) = Request.parse(json("embed", "\"texts\":[\"a\"],\"dimensions\":$v", version = "2")).dimensions
    assertEquals(768, dims("768"))
    assertEquals(768, dims("700"))
    assertEquals(128, dims("1"))
    assertEquals(3072, dims("3072"))
    assertEquals(3072, dims("5000"))
    rejects(json("embed", "\"texts\":[\"a\"],\"dimensions\":0"), "dimensions")
    rejects(json("embed", "\"texts\":[\"a\"],\"dimensions\":\"768\""), "dimensions")
    rejects(json("embed", "\"texts\":[\"a\"],\"dimensions\":76.8"), "dimensions")
  }

  @Test fun transcribeSegmentsIsABoolean() {
    val base = "\"fileName\":\"n.m4a\",\"mime\":\"audio/mp4\""
    assertEquals(true, Request.parse(json("transcribe", "$base,\"segments\":true", version = "2")).segments)
    assertEquals(false, Request.parse(json("transcribe", "$base,\"segments\":false")).segments)
    rejects(json("transcribe", "$base,\"segments\":\"yes\""), "true or false")
    rejects(json("transcribe", "$base,\"segments\":1"), "true or false")
  }

  @Test fun rejectsUnknownApiVersion() {
    rejects(json(version = "0"), "unknown")
    rejects(json(version = "\"1\""), "no apiVersion")
    rejects("""{"requestId":"r1","job":"chat","priority":"foreground","messages":$chatMessages}""", "no apiVersion")
  }

  @Test fun rejectsUnknownJob() = rejects(json("draw"), "chat, vision, embed or transcribe")

  @Test fun rejectsUnknownPriority() = rejects(json(priority = "\"urgent\""), "foreground or background")

  @Test fun rejectsBadRequestId() {
    rejects(json(id = "\"\""), "requestId", id = "")
    rejects(json(id = "\"${"a".repeat(65)}\""), "requestId", id = "")
    rejects(json(id = "\"a b\""), "requestId", id = "")
    rejects(json(id = "7"), "requestId", id = "")
    assertEquals("x".repeat(64), Request.parse(json(id = "\"${"x".repeat(64)}\"")).requestId)
  }

  @Test fun rejectsOver512Kb() {
    val big = json(extra = """"messages":[{"role":"user","content":"${"a".repeat(Request.MAX_JSON_BYTES)}"}]""")
    rejects(big, "512 KB", id = "")
  }

  @Test fun rejectsNotJson() = rejects("not json", "JSON object", id = "")

  @Test fun rejectsChatWithoutMessages() {
    rejects(json(extra = ""), "needs messages")
    rejects(json(extra = """"messages":[]"""), "needs messages")
    rejects(json(extra = """"messages":[{"role":"robot","content":"x"}]"""), "needs messages")
  }

  @Test fun rejectsBadTools() = rejects(json(extra = """"messages":$chatMessages,"tools":[{"name":"x"}]"""), "tool")

  @Test fun rejectsMaxTokensOutOfRange() {
    rejects(json(extra = """"messages":$chatMessages,"maxTokens":0"""), "1 to 8192")
    rejects(json(extra = """"messages":$chatMessages,"maxTokens":8193"""), "1 to 8192")
    rejects(json(extra = """"messages":$chatMessages,"maxTokens":1.5"""), "1 to 8192")
    assertEquals(8192, Request.parse(json(extra = """"messages":$chatMessages,"maxTokens":8192""")).maxTokens)
  }

  @Test fun rejectsVisionWithoutImageMimeOrUser() {
    rejects(json("vision", """"messages":$chatMessages"""), "mime")
    rejects(json("vision", """"messages":$chatMessages,"mime":"audio/mp4""""), "mime")
    rejects(json("vision", """"messages":[{"role":"system","content":"x"}],"mime":"image/jpeg""""), "user message")
  }

  @Test fun rejectsEmbedWithoutTexts() {
    rejects(json("embed", ""), "texts")
    rejects(json("embed", """"texts":[]"""), "texts")
    rejects(json("embed", """"texts":["a",""]"""), "texts")
    rejects(json("embed", """"texts":["a",3]"""), "texts")
  }

  @Test fun rejectsMoreThanEightTexts() {
    val texts = List(9) { "\"t$it\"" }.joinToString(",", "[", "]")
    rejects(json("embed", """"texts":$texts"""), "at most 8 texts")
    assertEquals(8, Request.parse(json("embed", """"texts":${List(8) { "\"t\"" }.joinToString(",", "[", "]")}""")).texts.size)
  }

  private val b64 = { b: ByteArray -> Base64.getEncoder().encodeToString(b) }

  @Test fun eightFullSizeVectorsFitOneBinderReplyAndRoundTrip() {
    val vectors = List(Request.MAX_TEXTS) { i -> FloatArray(3072) { j -> (i * 3072 + j) * 0.37f - 1e6f } }
    val text = Results.embed(vectors, "gemini-embedding-001", b64)
    assertTrue("${text.length * 2} bytes as UTF-16", text.length * 2 < 300 * 1024)
    val root = Json.parseToJsonElement(text).jsonObject
    assertEquals(3072, root["dims"]!!.jsonPrimitive.content.toInt())
    val back = root["vectorsB64"]!!.jsonArray.map { e ->
      val bytes = ByteBuffer.wrap(Base64.getDecoder().decode(e.jsonPrimitive.content)).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      FloatArray(bytes.remaining()).also { bytes.get(it) }
    }
    assertEquals(vectors.size, back.size)
    vectors.zip(back).forEach { (a, b) -> assertArrayEquals(a, b, 0f) }
  }

  @Test fun vectorBytesAreLittleEndianFloat32() {
    assertArrayEquals(byteArrayOf(0, 0, -128, 63), vectorBytes(floatArrayOf(1f)))
  }

  @Test fun onlyARegularFileWithinTheCapIsAccepted() {
    val vision = Request.parse(json("vision", """"messages":$chatMessages,"mime":"image/png""""))
    val audio = Request.parse(json("transcribe", """"fileName":"note.m4a","mime":"audio/mp4""""))
    assertEquals("Send the picture or audio as a file.", vision.attachmentProblem(false, 10))
    assertEquals("Send the picture or audio as a file.", audio.attachmentProblem(false, 0))
    assertNull(vision.attachmentProblem(true, 7L * 1024 * 1024))
    assertEquals("The picture is over 7 MB. Send a smaller one.", vision.attachmentProblem(true, 7L * 1024 * 1024 + 1))
    assertNull(audio.attachmentProblem(true, 25L * 1024 * 1024))
    assertEquals("The audio file is over 25 MB. Send a smaller one.", audio.attachmentProblem(true, 25L * 1024 * 1024 + 1))
    assertNull(Request.parse(json()).attachmentProblem(false, 0))
  }

  @Test fun rejectsTranscribeWithoutFileNameOrMime() {
    rejects(json("transcribe", """"mime":"audio/mp4""""), "fileName")
    rejects(json("transcribe", """"fileName":"a.m4a""""), "mime")
  }

  @Test fun idOfReadsOnlyAValidId() {
    assertEquals("r1", Request.idOf(json(version = "9")))
    assertEquals("", Request.idOf("""{"requestId":"a b"}"""))
    assertEquals("", Request.idOf(null))
  }

  @Test fun withImageAddsAPartToTheLastUserMessage() {
    val msgs = Request.parse(json()).messages
    val out = withImage(msgs, "image/png", "QUJD")
    assertEquals(msgs[0], out[0])
    val parts = out[1].json["content"]!!.jsonArray
    assertEquals("Hi", parts[0].jsonObject["text"]!!.jsonPrimitive.content)
    assertEquals("data:image/png;base64,QUJD", parts[1].jsonObject["image_url"]!!.jsonObject["url"]!!.jsonPrimitive.content)
    assertTrue(out[1].hasImage)
  }

  @Test fun readCappedStopsOverTheCap() {
    val data = ByteArray(200_000) { it.toByte() }
    assertArrayEquals(data, readCapped(ByteArrayInputStream(data), 200_000))
    assertNull(readCapped(ByteArrayInputStream(data), 199_999))
  }

  @Test fun readCappedWithASizeHintReadsAFileThatShrankOrGrew() {
    val data = ByteArray(200_000) { it.toByte() }
    for (hint in listOf(200_000L, 0L, 1_000L, 300_000L, Long.MAX_VALUE)) {
      assertArrayEquals("$hint", data, readCapped(ByteArrayInputStream(data), 250_000, hint))
    }
    assertNull(readCapped(ByteArrayInputStream(data), 199_999, 200_000))
  }

  @Test fun readCappedStopsBetweenChunksWhenTheCheckTurnsTrue() {
    val data = ByteArray(1_000_000)
    val input = ByteArrayInputStream(data)
    var checks = 0
    assertThrows(CancellationException::class.java) { readCapped(input, 2_000_000, 0) { ++checks > 2 } }
    assertEquals(3, checks)
    assertEquals(data.size - 2 * 64 * 1024, input.available())
    assertThrows(CancellationException::class.java) { readCapped(ByteArrayInputStream(data), 2_000_000) { true } }
  }

  @Test fun sharedUidWithStrongroomIsDenied() {
    val d = decideCallers(listOf("com.haroon.nexus", CallerPolicy.STRONGROOM), true, emptyMap(), "com.haroon.aihub")
    assertTrue(d is Decision.Deny)
    assertEquals(Decision.Allow, decideCallers(listOf("com.haroon.nexus"), true, mapOf("com.haroon.nexus" to true), "com.haroon.aihub"))
    assertEquals("com.haroon.nexus", (decideCallers(listOf("com.haroon.nexus"), true, emptyMap(), "com.haroon.aihub") as Decision.Deny).ask)
    assertTrue(decideCallers(emptyList(), true, emptyMap(), "com.haroon.aihub") is Decision.Deny)
  }

  @Test fun modelsFallBackToDefaults() {
    val m = Settings.models("""{"CHAT":{"service":"gemini","model":"g"},"vision":{"service":"groq","model":"x"},"embed":{"service":"gemini","model":""}}""")
    assertEquals(ModelChoice(Service.GEMINI, "g"), m[Job.CHAT])
    assertEquals(Job.VISION.default, m[Job.VISION])
    assertEquals(Job.EMBED.default, m[Job.EMBED])
    assertEquals(Job.TRANSCRIBE.default, m[Job.TRANSCRIBE])
    assertEquals(Job.entries.associateWith { it.default }, Settings.models("broken"))
  }

  @Test fun switchesReadBooleansOnly() {
    assertEquals(mapOf("a" to false, "b" to true), Settings.switches("""{"a":false,"b":true,"c":"no"}"""))
    assertEquals(emptyMap<String, Boolean>(), Settings.switches(null))
  }

  @Test fun statusCountsKeysWithoutKeys() {
    val s = Settings.status(mapOf(Service.GROQ to 2), mapOf(Service.GEMINI to 5L), Job.entries.associateWith { it.default })
    val root = Json.parseToJsonElement(s).jsonObject
    val services = root["services"]!!.jsonObject
    assertEquals(2, services["groq"]!!.jsonObject["keys"]!!.jsonPrimitive.content.toInt())
    assertEquals("null", services["groq"]!!.jsonObject["heldUntil"].toString())
    assertEquals("5", services["gemini"]!!.jsonObject["heldUntil"].toString())
    assertEquals("groq", root["models"]!!.jsonObject["chat"]!!.jsonObject["service"]!!.jsonPrimitive.content)
  }

  @Test fun resultShapes() {
    val turn = ModelTurn(
      Msgs.user("x"),
      listOf(ToolCall("c1", "look", JsonObject(mapOf("q" to JsonPrimitive("a"))))),
      TokenUsage(10, 2, 5),
      "hello",
      ModelChoice(Service.GEMINI, "gemini-3.5-flash-lite"),
    )
    val chat = Json.parseToJsonElement(Results.chat(turn)).jsonObject
    assertEquals("hello", chat["text"]!!.jsonPrimitive.content)
    assertEquals("look", chat["toolCalls"]!!.jsonArray[0].jsonObject["name"]!!.jsonPrimitive.content)
    assertEquals("5", chat["usage"]!!.jsonObject["outputTokens"].toString())
    assertEquals("gemini-3.5-flash-lite", chat["model"]!!.jsonPrimitive.content)
    val embed = Json.parseToJsonElement(Results.embed(listOf(floatArrayOf(0.5f, 1f)), "m", b64)).jsonObject
    assertEquals(setOf("vectorsB64", "dims", "model"), embed.keys)
    assertEquals("AAAAPwAAgD8=", embed["vectorsB64"]!!.jsonArray[0].jsonPrimitive.content)
    val plain = Json.parseToJsonElement(Results.transcribe(Transcript("hi"))).jsonObject
    assertEquals(setOf("text"), plain.keys)
    assertEquals("hi", plain["text"]!!.jsonPrimitive.content)
    val timed = Results.transcribe(Transcript("hi there", listOf(Segment(0.0, 1.5, "hi"), Segment(1.5, 2.25, " there"))))
    assertEquals("""{"text":"hi there","segments":[{"start":0.0,"end":1.5,"text":"hi"},{"start":1.5,"end":2.25,"text":" there"}]}""", timed)
  }
}
