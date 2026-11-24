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

  @Test fun `unpinning restarts the saved time, pinning keeps it`() {
    assertEquals(now, Expiry.savedAtOnPinChange(false, now))
    assertEquals(null, Expiry.savedAtOnPinChange(true, now))
    val unpinnedAt = Expiry.savedAtOnPinChange(false, now)!!
    assertFalse(Expiry.expired("text", unpinnedAt, false, now, 7))
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
