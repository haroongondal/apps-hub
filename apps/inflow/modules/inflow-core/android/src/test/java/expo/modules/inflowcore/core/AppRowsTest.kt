package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppRowsTest {
  private val sms = setOf("com.google.android.apps.messaging")
  private fun stat(pkg: String, label: String, lastAt: Long, today: Int = 0, hasChats: Boolean = false) = AppStat(pkg, label, lastAt, today, hasChats)

  @Test fun sameLabelNonContactAppsMergeNewestFirst() {
    val rows = AppRows.build(listOf(stat("a.cal", "Calendar", 10, 2), stat("b.cal", "calendar ", 20, 1)), sms)
    val row = rows.single()
    assertEquals(listOf("b.cal", "a.cal"), row.pkgs)
    assertEquals("calendar ", row.label)   // label of the newest
    assertEquals(3, row.today)
    assertEquals(20L, row.lastAt)
    assertFalse(row.byContact)
  }

  @Test fun contactAppsNeverMerge() {
    val rows = AppRows.build(
      listOf(
        stat("com.google.android.apps.messaging", "Chat", 5), stat("x.chat", "Chat", 6, hasChats = true),
        stat("y.chat", "Chat", 7, hasChats = true), stat("z.plain", "Chat", 8),
      ),
      sms,
    )
    assertEquals(4, rows.size)
    assertEquals(listOf(listOf("z.plain"), listOf("y.chat"), listOf("x.chat"), listOf("com.google.android.apps.messaging")), rows.map { it.pkgs })
  }

  @Test fun orderIsNewestThenLabelThenPkg() {
    val rows = AppRows.build(listOf(stat("p2", "Beta", 5), stat("p1", "Alpha", 5), stat("p0", "Alpha2", 9)), sms)
    assertEquals(listOf("Alpha2", "Alpha", "Beta"), rows.map { it.label })
  }

  @Test fun byContactFollowsContactApps() {
    val rows = AppRows.build(
      listOf(stat("com.google.android.apps.messaging", "Messages", 1), stat(Email.GMAIL, "Gmail", 2), stat(ContactApps.TEAMS, "Teams", 3), stat("c", "WA", 4, hasChats = true), stat("d", "Shop", 5)),
      sms,
    )
    assertEquals(mapOf("Messages" to true, "Gmail" to true, "Teams" to true, "WA" to true, "Shop" to false), rows.associate { it.label to it.byContact })
    assertTrue(rows.filter { it.byContact }.all { it.pkgs.size == 1 })
  }
}
