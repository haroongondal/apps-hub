package expo.modules.deputyagent.core

data class Prices(val inputPerM: Double, val cachedPerM: Double, val outputPerM: Double) {
  companion object {
    val geminiFlashLite = Prices(0.30, 0.03, 2.50) // Google's pricing page, 2026-10-29
  }
}

data class Caps(
  val maxSteps: Int = 30,
  val maxCostUsd: Double = 1.0,
  val maxMillis: Long = 10 * 60_000L,
  val dailyCostUsd: Double = 5.0,
)

enum class Cap { STEPS, COST, DAILY, TIME }

/** Safety rule 7: caps are counted here, never asked of the model. */
class Guard(private val caps: Caps, private val prices: Prices, private val now: () -> Long, private val spentToday: Double) {
  private val startedAt = now()
  var steps = 0
    private set
  var costUsd = 0.0
    private set

  fun countStep() {
    steps++
  }

  fun addUsage(u: Usage): Double {
    val cost = ((u.inputTokens - u.cachedTokens).coerceAtLeast(0) * prices.inputPerM + u.cachedTokens * prices.cachedPerM + u.outputTokens * prices.outputPerM) / 1_000_000
    costUsd += cost
    return cost
  }

  fun tripped(): Cap? = when {
    steps >= caps.maxSteps -> Cap.STEPS
    costUsd >= caps.maxCostUsd -> Cap.COST
    spentToday + costUsd >= caps.dailyCostUsd -> Cap.DAILY
    now() - startedAt >= caps.maxMillis -> Cap.TIME
    else -> null
  }

  fun describe(cap: Cap): String = when (cap) {
    Cap.STEPS -> "Stopped at the ${caps.maxSteps}-step limit."
    Cap.COST -> "Stopped at the $%.2f limit for one task.".format(caps.maxCostUsd)
    Cap.DAILY -> "Stopped at the $%.2f daily limit.".format(caps.dailyCostUsd)
    Cap.TIME -> "Stopped at the ${caps.maxMillis / 60_000}-minute limit."
  }
}
