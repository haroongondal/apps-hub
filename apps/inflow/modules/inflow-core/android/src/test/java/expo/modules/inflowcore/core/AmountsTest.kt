package expo.modules.inflowcore.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AmountsTest {
  @Test fun groupedAmountWithDecimals() {
    assertTrue(150_000L in Amounts.inText("PKR 1,500.00 at SHOP"))
    assertTrue(150_050L in Amounts.inText("charged 1,500.50 today"))
  }

  @Test fun amountGluedToItsPrefix() {
    assertEquals(setOf(50_000L), Amounts.inText("Rs.500 cashback"))
  }

  @Test fun maskedAccountNeverJoinsItsDigitRuns() {
    val found = Amounts.inText("A/C: 0847-1***2310")
    assertEquals(setOf(84_700L, 100L, 231_000L), found)
    assertTrue(found.all { it <= 231_000L })
  }

  @Test fun lakhGroupingReadsAsOneNumber() {
    assertTrue(15_000_000L in Amounts.inText("PKR 1,50,000"))
  }

  @Test fun wordsAndThreeDecimalsGiveNothingInvented() {
    assertTrue(Amounts.inText("five hundred rupees").isEmpty())
    assertFalse(Amounts.inText("rate 1.2345").any { it == 123L })
    assertTrue(100L in Amounts.inText("tax 1.000"))
  }

  @Test fun hugeNumbersAreSkippedNotWrapped() {
    assertTrue(Amounts.inText("ref 99999999999999999999999").isEmpty())
  }

  @Test fun costCountsCachedTokensAtTheCachedPrice() {
    val cost = Prices(0.30, 0.03, 2.50).cost(Usage(inputTokens = 1_000_000, cachedTokens = 400_000, outputTokens = 100_000))
    assertEquals(0.6 * 0.30 + 0.4 * 0.03 + 0.1 * 2.50, cost, 1e-9)
  }

  @Test fun cachedAboveInputNeverGoesNegative() {
    assertEquals(0.03, Prices(0.30, 0.03, 2.50).cost(Usage(500_000, 1_000_000, 0)), 1e-9)
  }

  @Test fun missingUsageIsEstimated() {
    val prices = Prices(0.30, 0.03, 2.50)
    // 4,000 input characters and 400 output characters: 1,000 and 100 tokens.
    assertEquals(1_000 * 0.30 / 1e6 + 100 * 2.50 / 1e6, prices.cost(Usage(0, 0, 0), inputChars = 4_000, outputChars = 400), 1e-12)
    // Usage the model did report is never replaced by the estimate.
    assertEquals(Prices(0.30, 0.03, 2.50).cost(Usage(10, 0, 0)), prices.cost(Usage(10, 0, 0), inputChars = 4_000, outputChars = 400), 1e-12)
  }
}
