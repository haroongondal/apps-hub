package expo.modules.aihubcore.core

import org.junit.Assert.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Test

class UsageTest {
  private val usage = Usage()
    .record("com.haroon.nexus", "groq", 10, 5, 100)
    .record("com.haroon.nexus", "groq", 1, 2, 200)
    .record("com.haroon.nexus", "gemini", 7, 0, 300)

  @Test fun recordAddsPerAppAndService() {
    assertEquals(UsageCount(2, 11, 7, 200), usage.apps["com.haroon.nexus"]!!["groq"])
    assertEquals(UsageCount(1, 7, 0, 300), usage.apps["com.haroon.nexus"]!!["gemini"])
  }

  @Test fun recordLeavesOriginalUnchanged() {
    val base = Usage()
    base.record("a", "groq", 1, 1, 1)
    assertEquals(emptyMap<String, Map<String, UsageCount>>(), base.apps)
  }

  @Test fun roundTrip() {
    assertEquals(usage, Usage.fromJson(usage.toJson()))
  }

  @Test fun unknownFieldsIgnored() {
    val json = """{"v":2,"apps":{"a":{"groq":{"calls":3,"inputTokens":1,"outputTokens":2,"lastUsedMs":9,"extra":"x"}}},"other":1}"""
    assertEquals(UsageCount(3, 1, 2, 9), Usage.fromJson(json).apps["a"]!!["groq"])
  }

  @Test fun corruptOrMissingGivesEmpty() {
    assertEquals(Usage(), Usage.fromJson("{not json"))
    assertEquals(Usage(), Usage.fromJson(""))
    assertEquals(Usage(), Usage.fromJson(null))
    assertEquals(Usage(), Usage.fromJson("""{"apps":{"a":5}}"""))
  }

  @Test fun onlyCountsAreSerialised() {
    val root = Json.parseToJsonElement(usage.toJson()).jsonObject
    assertEquals(setOf("apps"), root.keys)
    val services = root["apps"]!!.jsonObject.values.flatMap { it.jsonObject.values }
    assertEquals(2, services.size)
    services.forEach { assertEquals(setOf("calls", "inputTokens", "outputTokens", "lastUsedMs"), it.jsonObject.keys) }
  }
}
