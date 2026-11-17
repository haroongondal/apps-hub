package expo.modules.inflowcore.android

import expo.modules.inflowcore.core.Sms
import org.junit.Assert.assertTrue
import org.junit.Test

// Wiring pin only, NOT a proof of the promotional rule: there is no store-level SQL harness (R32), the rule was proven in sqlite3 on fixtures.
// This pins that the SQL carries the shared SMS package list and that every query uses the one PROMO_KEYS constant.
class PromoSqlWiringTest {
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
    assertTrue(c.notPromo("i").contains("NOT ${c.SMS_ITEM}"))   // other apps sharing a num: key are never folded
  }
}
