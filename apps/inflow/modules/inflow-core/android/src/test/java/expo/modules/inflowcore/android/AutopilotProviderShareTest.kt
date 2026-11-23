package expo.modules.inflowcore.android

import java.io.File
import expo.modules.inflowcore.core.BriefingShare
import expo.modules.inflowcore.core.NexusShares
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

  @Test fun theBriefingIsServedToHaloAloneDecidedOnTheBinderThreadBeforeAnyRow() {
    val src = File("src/main/java/expo/modules/inflowcore/android/AutopilotProvider.kt").readText()
    val branch = src.substringAfter("      BRIEFING -> MatrixCursor(BRIEFING_COLUMNS)").substringBefore("\n      }\n")
    val halo = "val halo = runCatching { BriefingShare.callerIsHalo(ctx?.packageManager?.getPackagesForUid(Binder.getCallingUid())) }.getOrDefault(false)"
    assertTrue(branch, branch.contains(halo))
    assertTrue(branch, branch.contains("if (halo && store != null && ctx != null) runCatching {"))
    assertTrue("the caller is decided before any row or refresh", branch.indexOf(halo) < branch.indexOf("BriefingShare.serve(") && branch.indexOf(halo) < branch.indexOf("maybeRefresh"))
    assertEquals(1, Regex("addRow").findAll(branch).count())
    // The two switches come from their own meta keys, exactly.
    assertTrue(branch.contains("val shareOn = Briefing.on(store.meta(Briefing.SHARE_META))"))
    assertTrue(branch.contains("BriefingShare.serve(shareOn, Briefing.on(store.meta(Briefing.HEALTH_META)), snapshot).forEach { c.addRow(it) }"))
  }

  // The Nexus shares (INFLOW_ASK_ITEMS_SHARE, INFLOW_ASK_IDS_SHARE, INFLOW_DEBITS_SHARE in inflow-shares.ts), on the same legacy authority, paged by since-id.
  private fun fixture(name: String) = File("../../../../../packages/autopilot-contract/fixtures/$name.share.json").also {
    assertTrue("fixture not found from ${File(".").absoluteFile}", it.isFile)
  }.let { Json.parseToJsonElement(it.readText()).jsonObject }

  @Test fun theNexusColumnsPathsAndPageEqualTheirShares() {
    for ((name, path, columns) in listOf(
      Triple("ask-items", NexusShares.ASK_ITEMS_PATH, NexusShares.ASK_ITEMS_COLUMNS),
      Triple("ask-ids", NexusShares.ASK_IDS_PATH, NexusShares.ASK_IDS_COLUMNS),
      Triple("debits", NexusShares.DEBITS_PATH, NexusShares.DEBITS_COLUMNS),
    )) {
      val share = fixture(name)
      assertEquals(name, share.getValue("columns").jsonArray.map { it.jsonPrimitive.content }, columns.toList())
      assertEquals(name, share.getValue("path").jsonPrimitive.content, path)
      assertEquals(name, share.getValue("authority").jsonPrimitive.content, AutopilotProvider.AUTHORITY)
      assertEquals(name, share.getValue("maxRows").jsonPrimitive.int, NexusShares.PAGE)
    }
  }

  @Test fun eachNexusPathChecksTheCallerAndItsOwnSwitchAndBuildsRowsOnlyThroughNexusShares() {
    val src = File("src/main/java/expo/modules/inflowcore/android/AutopilotProvider.kt").readText()
    val query = src.substringAfter("override fun query(").substringBefore("override fun update(")
    assertTrue(query.trimStart().substringAfter("{").trimStart().startsWith("requireSibling()"))
    for ((match, meta, rows) in listOf(
      Triple("ASK_ITEMS", "NexusShares.ASK_META", "store!!.nexusAskItems(since, NexusShares.PAGE).mapNotNull(NexusShares::askRow)"),
      Triple("ASK_IDS", "NexusShares.ASK_META", "store!!.nexusAskIds(since, NexusShares.PAGE).mapNotNull(NexusShares::idRow)"),
      Triple("DEBITS", "NexusShares.DEBITS_META", "SqlLedgerStore(store!!.db).nexusDebits(since, NexusShares.debitsFrom(now), NexusShares.PAGE).mapNotNull { NexusShares.debitRow(it, now) }"),
    )) {
      val branch = query.substringAfter("      $match -> MatrixCursor(NexusShares.${match}_COLUMNS)").substringBefore("\n      }\n")
      assertTrue(match, branch.contains("val since = nexusSince(uri, store, $meta)"))
      assertTrue(match, branch.contains("if (since != null) runCatching { $rows }"))
      assertTrue(match, src.contains("addURI(AUTHORITY, \"\${NexusShares.${match}_PATH}/*\", $match)"))
    }
    // The caller is read on the binder thread, before any hop, from the calling uid's packages; NexusShares.since decides.
    assertTrue(src.contains("NexusShares.since(context?.packageManager?.getPackagesForUid(Binder.getCallingUid()), store?.meta(switchMeta), uri.lastPathSegment)"))
    assertTrue(src.contains("}.getOrNull()"))
  }
}
