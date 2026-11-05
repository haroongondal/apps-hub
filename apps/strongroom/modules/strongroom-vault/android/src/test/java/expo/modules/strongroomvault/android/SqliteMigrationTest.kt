package expo.modules.strongroomvault.android

import org.junit.Assert.assertEquals
import org.junit.Test

// No SQLite on the JVM here (no Robolectric): the statements are checked as text, and Task 6 runs the real upgrade on the emulator.
class SqliteMigrationTest {
  @Test fun upgradeMarksExistingRecordsDirty() {
    assertEquals(2, Schema.VERSION)
    assertEquals(
      listOf(
        "ALTER TABLE records ADD COLUMN rev INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE records ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0",
        "UPDATE records SET dirty = 1",
        "CREATE TABLE meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)",
        "CREATE TABLE quarantine(id TEXT NOT NULL, rev INTEGER NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY (id, rev))",
      ),
      Schema.upgrade(1),
    )
    assertEquals(emptyList<String>(), Schema.upgrade(2))
    assertEquals(
      listOf(
        "CREATE TABLE header(k TEXT PRIMARY KEY, v TEXT)",
        "CREATE TABLE records(id TEXT PRIMARY KEY, sealed BLOB NOT NULL, rev INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0)",
      ) + Schema.upgrade(1).drop(3),
      Schema.CREATE,
    )
  }
}
