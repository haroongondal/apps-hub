package expo.modules.inflowcore.android

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// No store-level SQL harness (R32): the v8 to v9 upgrade and SqlHealthStore's SQL were run in sqlite3 (docs/handoffs/vitals-sql-proof.md); MemoryHealthStore is the twin. This pins the pieces.
class HealthSqlWiringTest {
  @Test fun v9AddsOnlyTheDailyTable() {
    assertEquals(
      listOf("CREATE TABLE health_daily(day TEXT PRIMARY KEY, steps INTEGER, sleep_minutes INTEGER, hr_avg INTEGER, hr_low INTEGER, updated_at INTEGER NOT NULL)"),
      SqlItemStore.SCHEMA_V9,
    )
  }

  @Test fun everyStatementUsesTheDailyTableOnly() {
    for (sql in listOf(SqlHealthStore.DELETE_RANGE, SqlHealthStore.UPSERT, SqlHealthStore.PRUNE, SqlHealthStore.RANGE)) {
      assertTrue(sql, sql.contains("health_daily"))
      for (other in listOf("items", "ai_results", "ai_queue", "txns", "suggestions", "meta")) assertTrue(sql, !Regex("\\b$other\\b").containsMatchIn(sql))
    }
  }

  @Test fun noOtherCodeReadsTheHealthTable() {
    val src = File("src/main/java")   // Gradle runs module unit tests from the module's android/ folder
    assertTrue("sources not found from ${File(".").absoluteFile}", src.isDirectory)
    val users = src.walk().filter { it.isFile && it.extension == "kt" && it.readText().contains("health_daily") }.map { it.name }.toSet()
    assertEquals(setOf("SqlItemStore.kt", "SqlHealthStore.kt"), users)
    assertEquals(1, File(src, "expo/modules/inflowcore/android/SqlItemStore.kt").readLines().count { it.contains("health_daily") && !it.trimStart().startsWith("//") })
  }
}
