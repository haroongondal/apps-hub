package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.AiChannels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// No store-level SQL harness (R32): the filter text is run in sqlite3 by hand; this pins that it carries R44 and the shared package list.
class AiFilterTest {
  @Test fun neverSendFilterKeepsOnlySmsAndEmail() {
    val f = SqlItemStore.NEVER_SEND_FILTER
    assertTrue(f.contains("i.sms_hash IS NOT NULL OR i.email_hash IS NOT NULL OR i.pkg IN (${AiChannels.SQL_LIST})"))
    AiChannels.PKGS.forEach { assertTrue(it, f.contains("'$it'")) }
    assertEquals(4, AiChannels.PKGS.size)
  }
}
