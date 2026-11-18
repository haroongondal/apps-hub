package expo.modules.inflowcore.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// No store-level SQL harness (R32): the v7 to v8 upgrade and SqlSuggestionStore's SQL were run in sqlite3 by hand. This pins the pieces the upgrade must carry.
class SuggestionSchemaWiringTest {
  @Test fun v8AddsTheFastColumnAndTheSuggestionsTable() {
    val sql = SqlItemStore.SCHEMA_V8.joinToString("\n")
    assertTrue(sql.contains("ALTER TABLE ai_queue ADD COLUMN fast INTEGER NOT NULL DEFAULT 0"))
    for (col in listOf("id INTEGER PRIMARY KEY AUTOINCREMENT", "kind", "title", "item_id", "due_at", "dedupe_key", "state", "created_at", "updated_at", "expires_at")) {
      assertTrue(col, sql.contains(col))
    }
    assertTrue(sql.contains("CREATE INDEX suggestions_state ON suggestions(state)"))
    assertEquals(3, SqlItemStore.SCHEMA_V8.size)   // an ALTER keeps every existing row, so no table is rebuilt
  }
}
