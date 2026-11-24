package expo.modules.inflowcore.core

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

// src/aiHub.ts reads the same file: the words a screen matches in TypeScript are the words this side writes.
class HubCopyTest {
  @Test fun theFixtureEqualsTheNativeCopy() {
    val o = Json.parseToJsonElement(File("../fixtures/ai-hub-copy.json").readText()).jsonObject
    val got = o.mapValues { it.value.jsonPrimitive.content }
    assertEquals(mapOf("missing" to HubCopy.MISSING, "not-allowed" to HubCopy.NOT_ALLOWED, "version" to HubCopy.VERSION, "no-key" to HubCopy.NO_KEY), got)
  }
}
