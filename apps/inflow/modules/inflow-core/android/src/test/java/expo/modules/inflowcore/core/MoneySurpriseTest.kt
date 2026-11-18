package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MoneySurpriseTest {
  private val cfg = MoneySurpriseConfig()
  private fun out(minor: Long, history: List<Long> = emptyList(), currency: String = "PKR", own: Boolean = false) =
    MoneySurprise.check(Direction.OUT, minor, currency, own, "Shop", history, emptySet(), cfg)

  private fun inn(counterparty: String?, known: Set<String> = emptySet(), own: Boolean = false, currency: String = "PKR") =
    MoneySurprise.check(Direction.IN, 100_000, currency, own, counterparty, emptyList(), known, cfg)

  @Test fun defaults() {
    assertEquals(3, cfg.multiple); assertEquals(500_000L, cfg.minMinor); assertEquals(5_000_000L, cfg.hugeMinor)
  }

  @Test fun debitUnderTheFloorIsNotASurpriseEvenAtThreeTimes() =
    assertFalse(out(3_300_00, listOf(1000_00, 1200_00, 1100_00)))

  @Test fun debitThreeTimesTheMedianAndOverTheFloor() = assertTrue(out(6_000_00, listOf(1_500_00)))

  @Test fun debitUnderThreeTimesIsNotASurprise() = assertFalse(out(6_000_00, listOf(3_000_00)))

  @Test fun evenHistoryUsesTheMeanOfTheMiddleTwo() {
    // median of 2,000 and 4,000 is 3,000: 9,000 is exactly 3x and over the floor
    assertTrue(out(9_000_00, listOf(4_000_00, 2_000_00)))
    assertFalse(out(8_900_00, listOf(4_000_00, 2_000_00)))
  }

  @Test fun hugeDebitIsASurpriseWithoutHistory() {
    assertTrue(out(60_000_00))
    assertFalse(out(50_000_00)) // "more than" 50,000
    assertFalse(out(20_000_00))
  }

  @Test fun moneyInFromAnUnseenName() {
    assertTrue(inn("Bilal"))
    assertTrue(inn(" bilal ", known = setOf("Ali")))
    assertFalse(inn("Ali", known = setOf("ali")))
    assertFalse(inn(null))
    assertFalse(inn("  "))
    assertFalse(inn("Bilal", own = true))
  }

  @Test fun ownMoneyOutIsNeverASurprise() = assertFalse(out(60_000_00, own = true))

  @Test fun onlyPkr() {
    assertFalse(out(60_000_00, currency = "USD"))
    assertFalse(inn("Bilal", currency = "USD"))
    assertTrue(out(60_000_00, currency = "pkr"))
  }
}
