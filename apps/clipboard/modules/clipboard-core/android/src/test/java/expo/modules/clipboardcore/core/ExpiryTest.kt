package expo.modules.clipboardcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExpiryTest {
  private val day = 86_400_000L
  private val now = 1_000 * day

  @Test fun `text goes after the retention days and not before`() {
    assertFalse(Expiry.expired("text", now - 30 * day + 1, false, now, 30))
    assertTrue(Expiry.expired("text", now - 30 * day, false, now, 30))
    assertFalse(Expiry.expired("image", now - 89 * day, false, now, 90))
    assertTrue(Expiry.expired("secret", now - 8 * day, false, now, 7))
  }

  @Test fun `pinned clips never expire, except a one-time code`() {
    assertFalse(Expiry.expired("text", 0, true, now, 7))
    assertFalse(Expiry.expired("secret", 0, true, now, 7))
    assertFalse(Expiry.expired("code", now - Expiry.CODE_MS + 1, true, now, 7))
    assertTrue(Expiry.expired("code", now - Expiry.CODE_MS, true, now, 7))
  }

  @Test fun `a pin change writes the pin flag and its time, never the newest-clip time`() {
    for (pinned in listOf(true, false)) {
      val cols = Expiry.pinColumns(pinned, now)
      assertEquals(setOf("pinned", "pinned_at"), cols.keys)
      assertEquals(now, cols["pinned_at"])
    }
  }

  // Y is the newest clip (still on the clipboard); X is older. Unpinning X must leave Y the newest, or a restart saves Y again.
  @Test fun `unpinning an older clip leaves the newest clip the newest`() {
    class Row(val id: Long, var at: Long, var pinnedAt: Long?)
    val x = Row(1, now - 40 * day, now - 41 * day)
    val y = Row(2, now - 5 * 60_000L, null)
    Expiry.pinColumns(false, now).forEach { (k, v) -> if (k == "at") x.at = v else if (k == "pinned_at") x.pinnedAt = v }
    assertEquals(y.id, listOf(x, y).maxWith(compareBy<Row> { it.at }.thenBy { it.id }).id)
  }

  @Test fun `an old clip just unpinned is not deleted, and ages from the unpin`() {
    val at = now - 40 * day
    assertTrue(Expiry.expired("text", Expiry.savedAt("text", at, null), false, now, 30))
    val saved = Expiry.savedAt("text", at, now)
    assertEquals(now, saved)
    assertFalse(Expiry.expired("text", saved, false, now, 30))
    assertTrue(Expiry.expired("text", saved, false, now + 30 * day, 30))
  }

  @Test fun `a code ages from when it was copied, not from a pin change`() {
    assertEquals(now - 1, Expiry.savedAt("code", now - 1, now))
    assertTrue(Expiry.expired("code", Expiry.savedAt("code", now - Expiry.CODE_MS, now), false, now, 365))
  }

  @Test fun `codes go after 10 minutes whatever the setting`() {
    assertFalse(Expiry.expired("code", now - Expiry.CODE_MS + 1, false, now, 365))
    assertTrue(Expiry.expired("code", now - Expiry.CODE_MS, false, now, 365))
    assertFalse(Expiry.expired("text", now - Expiry.CODE_MS, false, now, 7))
  }

  @Test fun `unknown saved retention falls back to 30 days`() {
    assertEquals(30, Expiry.days(null))
    assertEquals(30, Expiry.days(0))
    assertEquals(30, Expiry.days(-5))
    assertEquals(90, Expiry.days(90))
  }
}
