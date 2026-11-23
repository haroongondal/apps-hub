package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.HealthTables
import expo.modules.inflowcore.core.Suggestion
import expo.modules.inflowcore.core.SuggestionKind
import expo.modules.inflowcore.core.SuggestionState
import expo.modules.inflowcore.core.toMap
import expo.modules.inflowcore.core.toRow
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The v10 SQL was run in sqlite3 (docs/handoffs/vitals-sql-proof.md); MemoryMedicineStore and MemoryJournalStore are the twins. This pins the text and fences the health tables off.
class VitalsSqlWiringTest {
  private val src = File("src/main/java")   // Gradle runs module unit tests from the module's android/ folder
  private val names = HealthTables.ALL.joinToString("|")
  private val sqlMention = Regex("(?i)\\b(FROM|JOIN|INTO|UPDATE|TABLE|ON)\\s+($names)\\b")
  private val wordMention = Regex("\\b($names)\\b")
  private val healthStores = setOf("SqlItemStore.kt", "SqlHealthStore.kt", "SqlMedicineStore.kt", "SqlJournalStore.kt")
  private val dataPaths = Regex("^(Ai|Ask|Autopilot|Item|Ingest|Suggestion|SqlSuggestion|SqlLedger|SqlBackfill|SqlReport|Ledger|Report|Capture|Retention).*\\.kt$")

  private fun sources() = src.walk().filter { it.isFile && it.extension == "kt" }.toList().also { assertTrue("sources not found from ${File(".").absoluteFile}", it.isNotEmpty()) }

  private fun code(f: File) = f.readLines().filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") || it.trimStart().startsWith("/*") }

  @Test fun v10AddsTheThreeTablesAndTheJournalIndex() {
    assertEquals(
      listOf(
        "CREATE TABLE medicines(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dose TEXT NOT NULL, times TEXT NOT NULL, days TEXT NOT NULL, " +
          "start_day TEXT NOT NULL, end_day TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)",
        "CREATE TABLE dose_log(medicine_id INTEGER NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL, marked_at INTEGER NOT NULL, PRIMARY KEY(medicine_id, due_at))",
        "CREATE TABLE journal(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, mood INTEGER NOT NULL, tags TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL)",
        "CREATE INDEX journal_at ON journal(at)",
      ),
      SqlItemStore.SCHEMA_V10,
    )
  }

  @Test fun eachStoreUsesOnlyItsOwnTables() {
    val med = listOf(SqlMedicineStore.ALL, SqlMedicineStore.ONE, SqlMedicineStore.INSERT, SqlMedicineStore.UPDATE, SqlMedicineStore.STOP, SqlMedicineStore.DELETE_LOG, SqlMedicineStore.DELETE, SqlMedicineStore.LOG_RANGE, SqlMedicineStore.MARK, SqlMedicineStore.MISSED)
    val journal = listOf(SqlJournalStore.PAGE, SqlJournalStore.INSERT, SqlJournalStore.UPDATE, SqlJournalStore.DELETE)
    for (sql in med) assertTrue(sql, Regex("\\b(medicines|dose_log)\\b").containsMatchIn(sql))
    for (sql in journal) assertTrue(sql, Regex("\\bjournal\\b").containsMatchIn(sql))
    for (sql in med + journal) for (other in listOf("items", "ai_results", "ai_queue", "txns", "suggestions", "meta", "health_daily")) assertTrue(sql, !Regex("\\b$other\\b").containsMatchIn(sql))
    for (sql in journal) assertTrue(sql, !Regex("\\b(medicines|dose_log)\\b").containsMatchIn(sql))
    for (sql in med) assertTrue(sql, !Regex("\\bjournal\\b").containsMatchIn(sql))
  }

  @Test fun onlyTheSchemaAndTheHealthStoresHaveSqlOnHealthTables() {
    val users = sources().filter { f -> code(f).any { sqlMention.containsMatchIn(it) } }.map { it.name }.toSet()
    assertEquals(healthStores, users)
    val schema = code(File(src, "expo/modules/inflowcore/android/SqlItemStore.kt")).filter { wordMention.containsMatchIn(it) }
    assertEquals(5, schema.size)
    assertTrue(schema.joinToString("\n"), schema.all { it.trimStart().startsWith("\"CREATE TABLE ") || it.trimStart().startsWith("\"CREATE INDEX ") })
  }

  @Test fun theItemsAiAskAndAutopilotCodeNeverNamesAHealthTable() {
    val paths = sources().filter { dataPaths.matches(it.name) }
    assertTrue(paths.map { it.name }.containsAll(listOf("Ask.kt", "AiRunner.kt", "AutopilotApi.kt", "AutopilotProvider.kt", "AiQueue.kt", "ItemStore.kt", "Ingest.kt", "SqlSuggestionStore.kt")))
    for (f in paths) assertTrue("${f.name} names a health table", f.readLines().none { wordMention.containsMatchIn(it) })
  }

  // V4 / R10: Ask gets health only through HealthForAsk.context, gated by the setting; the batch prompts, reports and Autopilot never touch it.
  private val healthCode = Regex("\\b(Sql(Health|Medicine|Journal)Store|HealthStore|MedicineStore|JournalStore|HealthForAsk|HealthDay|JournalEntry|Medicines?|Journal|Dose\\w*|Doctor\\w*)\\b")

  private fun file(name: String) = sources().single { it.name == name }

  @Test fun askReachesHealthOnlyThroughTheGate() {
    val runner = code(file("AiRunner.kt")).filter { healthCode.containsMatchIn(it) && !it.startsWith("import ") }
    assertEquals(1, runner.size)
    assertTrue(runner.single(), runner.single().trim().startsWith("val health = HealthForAsk.context(HealthForAsk.on(store.meta(HealthForAsk.META)), "))
    val ask = code(file("Ask.kt")).flatMap { healthCode.findAll(it).map { m -> m.value }.toList() }.toSet()
    assertEquals(setOf("HealthForAsk"), ask)
  }

  @Test fun batchPromptsReportsAndAutopilotNeverTouchHealth() {
    val paths = sources().filter { dataPaths.matches(it.name) && it.name != "Ask.kt" && it.name != "AiRunner.kt" }
    assertTrue(paths.map { it.name }.containsAll(listOf("Ai.kt", "AiQueue.kt", "AutopilotApi.kt", "AutopilotProvider.kt", "AutopilotAccess.kt", "Reports.kt", "SuggestionRules.kt")))
    for (f in paths) assertTrue("${f.name} touches health", code(f).none { healthCode.containsMatchIn(it) })
  }

  @Test fun theDoctorSummaryReadsHealthOnlyThroughTheStores() {
    val sql = Regex("\\b(SELECT|INSERT|DELETE|UPDATE|JOIN)\\b|rawQuery|execSQL|compileStatement|\\.query\\(|\\.run\\(")
    for (name in listOf("DoctorSummary.kt", "DoctorRunner.kt", "DoctorPdf.kt", "PdfLayout.kt", "HealthForAsk.kt")) {
      assertTrue(name, code(file(name)).none { sql.containsMatchIn(it) })
    }
  }

  @Test fun noSharedRowOrColumnCarriesHealth() {
    // Gradle runs module unit tests from the module's android/ folder: five levels up is the repo root.
    val words = Json.parseToJsonElement(File("../../../../../packages/autopilot-contract/fixtures/never-share-data.json").readText()).jsonArray.map { it.jsonPrimitive.content }
    assertEquals(listOf("health", "journal", "medicine", "steps", "sleep", "heart"), words)
    val row = Suggestion(1, SuggestionKind.REPLY, "t", 1, null, "k", SuggestionState.WAITING, 0, 0, 0).toRow()
    // The provider's column arrays live in a private companion next to a UriMatcher (an Android stub here), so they are read from its source.
    val columns = code(file("AutopilotProvider.kt")).filter { it.contains("_COLUMNS = arrayOf(") }.flatMap { Regex("\"([^\"]+)\"").findAll(it).map { m -> m.groupValues[1] }.toList() }
    assertEquals(15, columns.size)
    val names = row.keys + columns + SuggestionKind.values().map { it.name } + AutopilotSettings().toMap().keys
    for (n in names) for (w in words) assertTrue("$n carries $w", !n.lowercase().contains(w))
  }
}
