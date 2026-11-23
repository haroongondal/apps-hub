package expo.modules.inflowcore.android

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binds the provider's column array, authority and row cap to the share the TS contract declares (the pattern README.md asks every provider to follow). */
class AutopilotProviderShareTest {
  // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
  private val share = File("../../../../../packages/autopilot-contract/fixtures/suggestions.share.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonObject }

  @Test fun theRowColumnsEqualTheShareColumnsInOrder() =
    assertEquals(share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, AutopilotProvider.ROW_COLUMNS.toList())

  @Test fun theAuthorityEqualsTheShareAuthority() =
    assertEquals(share.getValue("authority").jsonPrimitive.content, AutopilotProvider.AUTHORITY)

  @Test fun theListLimitIsWithinTheShareRowCap() =
    assertTrue(AutopilotProvider.LIST_LIMIT <= share.getValue("maxRows").jsonPrimitive.int)
}
