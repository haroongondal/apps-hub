package expo.modules.inflowcore.android

import java.io.File
import expo.modules.inflowcore.core.BriefingShare
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

  // The health share (appHealthShare('inflow')): its fixture has no authority, which comes from HEALTH_AUTHORITIES in health.ts.
  private val health = File("../../../../../packages/app-link-contract/fixtures/app-health.share.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonObject }

  @Test fun theHealthColumnsEqualTheHealthShareColumnsInOrder() =
    assertEquals(health.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, AutopilotProvider.HEALTH_COLUMNS.toList())

  @Test fun theHealthRowCapEqualsTheHealthShareCap() =
    assertEquals(health.getValue("maxRows").jsonPrimitive.int, AutopilotProvider.HEALTH_MAX_ROWS)

  @Test fun theHealthPathIsTheSharePath() =
    assertEquals(health.getValue("path").jsonPrimitive.content, "health")

  @Test fun theLegacyAuthorityIsTheOneHealthAuthoritiesGivesInflow() {
    val src = File("../../../../../packages/app-link-contract/src/health.ts").readText()
    val declared = Regex("""\binflow: '([^']+)'""").find(src)?.groupValues?.get(1)
    assertEquals("com.haroon.inflow.autopilot", declared)
    assertEquals(declared, AutopilotProvider.AUTHORITY)
  }

  // The briefing share (INFLOW_BRIEFING_SHARE in inflow-shares.ts), on the same legacy authority.
  private val briefing = File("../../../../../packages/autopilot-contract/fixtures/briefing.share.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonObject }

  @Test fun theBriefingColumnsEqualTheBriefingShareColumnsInOrder() =
    assertEquals(briefing.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, AutopilotProvider.BRIEFING_COLUMNS.toList())

  @Test fun theBriefingRowCapEqualsTheShareCap() =
    assertEquals(briefing.getValue("maxRows").jsonPrimitive.int, AutopilotProvider.BRIEFING_MAX_ROWS)

  @Test fun theBriefingPathAndAuthorityAreTheShares() {
    assertEquals(briefing.getValue("path").jsonPrimitive.content, BriefingShare.PATH)
    assertEquals(briefing.getValue("authority").jsonPrimitive.content, AutopilotProvider.AUTHORITY)
  }

  @Test fun theProviderMatchesTheBriefingPathAndAnswersItAsAReadOnlyDirectory() {
    val src = File("src/main/java/expo/modules/inflowcore/android/AutopilotProvider.kt").readText()
    assertTrue(src.contains("addURI(AUTHORITY, BriefingShare.PATH, BRIEFING)"))
    assertTrue(src.contains("BriefingShare.serve(shareOn, "))   // the one way rows reach the cursor: the share and health switches are decided there
    assertTrue(src.contains("override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException"))
    assertTrue(src.contains("override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException"))
    // update only moves a suggestion (path suggestions/#); every other path, the briefing included, answers 0
    assertTrue(src.contains("if (matcher.match(uri) != ONE) return 0"))
  }
}
