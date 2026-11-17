package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.Sms
import org.junit.Assert.assertTrue
import org.junit.Test

// No store-level SQL harness (R32): the promotional-sender SQL was proven in sqlite3 on fixtures; this pins that it carries the shared SMS package list and is used as one constant.
class PromoSqlTest {
  @Test fun smsItemCarriesEveryKnownSmsApp() {
    Sms.KNOWN_APPS.forEach { assertTrue(it, SqlItemStore.SMS_ITEM.contains("'$it'")) }
    assertTrue(SqlItemStore.SMS_ITEM.contains("i.sms_hash IS NOT NULL"))
  }

  @Test fun everyQueryUsesTheSamePromoKeys() {
    val c = SqlItemStore.Companion
    for (sql in listOf(c.HOME_CONVERSATIONS_SQL, c.HOME_IMPORTANT_SQL, c.statsSql(true), c.contactsSql(false, false), c.contactsSql(true, true), c.PROMOTIONS_SQL, c.SMS_PROMOTION_SQL)) {
      assertTrue(sql, sql.contains(c.PROMO_KEYS))
    }
    assertTrue(!c.statsSql(false).contains(c.PROMO_KEYS))
    assertTrue(c.contactsSql(true, false).contains("NOT " + c.notPromo("i")))
  }
}
