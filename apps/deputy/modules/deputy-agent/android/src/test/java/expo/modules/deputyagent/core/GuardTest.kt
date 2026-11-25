package expo.modules.deputyagent.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GuardTest {
  private val prices = Prices(inputPerM = 0.75, cachedPerM = 0.075, outputPerM = 3.75)
  private var clock = 1_000L
  private fun guard(caps: Caps = Caps(), spentToday: Double = 0.0) = Guard(caps, prices, { clock }, spentToday)

  @Test fun chargesUncachedCachedAndOutputTokensAtTheirOwnPrice() {
    val g = guard()
    assertEquals(0.855, g.addUsage(Usage(inputTokens = 1_000_000, cachedTokens = 400_000, outputTokens = 100_000)), 1e-9)
    assertEquals(0.855, g.costUsd, 1e-9)
  }

  @Test fun aStepTheHubServedIsPricedByTheModelTheHubNamesNotByTheOwnersModel() {
    val g = guard()
    val u = Usage(inputTokens = 1_000_000, cachedTokens = 400_000, outputTokens = 100_000)
    assertEquals(0.18 + 0.012 + 0.25, g.addUsage(u, "gemini-3.5-flash-lite"), 1e-9)
    assertEquals(0.09 + 0.03 + 0.06, g.addUsage(u, "openai/gpt-oss-120b"), 1e-9)
  }

  @Test fun aHubModelDeputyDoesNotKnowCountsAtAHighCeilingSoAProModelCannotOutrunTheCostLimits() {
    assertEquals(Prices.HUB_CEILING, Settings.pricesOfHubModel("gemini-9-pro", prices))
    assertEquals(Prices(4.00, 0.40, 18.00), Prices.HUB_CEILING)
    assertEquals(Prices(5.0, 0.5, 20.0), Settings.pricesOfHubModel("gemini-9-pro", Prices(5.0, 0.5, 20.0)))
    val g = guard(Caps(maxCostUsd = 0.5))
    g.addUsage(Usage(inputTokens = 100_000, cachedTokens = 0, outputTokens = 5_000), "gemini-9-pro")
    assertEquals(0.4 + 0.09, g.costUsd, 1e-9)
    assertNull(g.tripped())
    g.addUsage(Usage(inputTokens = 5_000, cachedTokens = 0, outputTokens = 0), "gemini-9-pro")
    assertEquals(Cap.COST, g.tripped())
  }

  @Test fun cachedTokensAboveTheInputCountNeverLowerTheCost() {
    val g = guard()
    assertEquals(0.000375, g.addUsage(Usage(inputTokens = 1_000, cachedTokens = 5_000, outputTokens = 0)), 1e-12)
  }

  @Test fun stepCapTripsOnlyAfterTheLastAllowedStep() {
    val g = guard(Caps(maxSteps = 2))
    g.countStep()
    assertNull(g.tripped())
    g.countStep()
    assertEquals(Cap.STEPS, g.tripped())
  }

  @Test fun costCapTripsOnceTheRunHasSpentIt() {
    val g = guard(Caps(maxCostUsd = 0.5))
    g.addUsage(Usage(400_000, 0, 0))
    assertNull(g.tripped())
    g.addUsage(Usage(400_000, 0, 0))
    assertEquals(Cap.COST, g.tripped())
  }

  @Test fun timeCapCountsFromWhenTheRunStarted() {
    val g = guard(Caps(maxMillis = 600_000))
    clock += 599_999
    assertNull(g.tripped())
    clock += 1
    assertEquals(Cap.TIME, g.tripped())
  }

  @Test fun dailyCapIncludesWhatEarlierRunsSpentToday() {
    val g = guard(Caps(maxCostUsd = 10.0, dailyCostUsd = 5.0), spentToday = 4.5)
    g.addUsage(Usage(400_000, 0, 0))
    assertNull(g.tripped())
    g.addUsage(Usage(400_000, 0, 0))
    assertEquals(Cap.DAILY, g.tripped())
  }
}
