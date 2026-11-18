package expo.modules.designmedia.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClipTokenizerTest {
  private val tokenizer = ClipTokenizer.fromJson(File(System.getProperty("module.assets"), "clip/tokenizer.json").readText())

  @Test
  fun encodesLikeTheReference() {
    val cases = Json.parseToJsonElement(fixtureText("photo-search/tokens.json")).jsonArray
    assertEquals(987, cases.size)
    val bad = cases.map { it.jsonObject }.mapNotNull { c ->
      val text = c.getValue("text").jsonPrimitive.content
      val want = c.getValue("ids").jsonArray.map { it.jsonPrimitive.int }
      val got = tokenizer.encode(text).toList()
      if (got == want) null else "'$text' want $want got $got"
    }
    assertTrue("${bad.size} mismatches, first: ${bad.take(5)}", bad.isEmpty())
  }

  @Test
  fun alwaysWrapsAndCaps() {
    assertEquals(listOf(49406, 49407), tokenizer.encode("").toList())
    val long = tokenizer.encode("x".repeat(200))
    assertTrue(long.size <= 77)
    assertEquals(49407, long.last())
  }

  @Test
  fun truncatesToSeventySevenKeepingTheEnd() {
    val ids = tokenizer.encode("dog ".repeat(100))
    assertEquals(77, ids.size)
    assertEquals(49406, ids.first())
    assertEquals(49407, ids.last())
  }
}
