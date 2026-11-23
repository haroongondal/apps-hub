package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.HealthTables
import java.io.File
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
}
