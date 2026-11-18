package expo.modules.inflowcore.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Meta keys of the AI settings (the SQL schema v4 comment lists them). */
object AiMeta {
  const val BASE_URL = "aiBaseUrl"
  const val MODEL = "aiModel"
  const val CUSTOM_PRICES = "aiCustomPrices"
  const val CAP_USD = "aiCapUsd"
  const val SINCE = "aiSince"
  const val LAST_RUN_AT = "aiLastRunAt"
  const val ERROR = "aiError"

  /** What ERROR holds after a run (null deletes it). A fast run that saved nothing leaves it alone: it may not have reached the provider at all, so it knows nothing about the full run's key error. */
  fun errorAfter(fastOnly: Boolean, r: AiRunResult, current: String?): String? =
    if (r.error != null) r.error else if (fastOnly && r.saved == 0) current else null
}

interface AiStore {
  /** Time the first key was added; null = AI off. */
  fun enabledSince(): Long?
  /**
   * The send-time filter: item exists, not OTP, SMS or email (or in a conversation the owner picked for Autopilot, the one R44 exception),
   * posted_at >= enabledSince, app record on, app and sender not blocked. Oldest first. Queue rows that fail it are deleted.
   * `fastOnly` returns only the rows Autopilot marked fast.
   */
  fun queued(limit: Int, fastOnly: Boolean = false): List<AiInput>
  /** Results and their to-dos; removes those items from the queue. */
  fun save(results: List<AiResult>, now: Long)
  /** First failure: tries = 1; second: removed from the queue. */
  fun failed(itemIds: List<Long>)
  fun spentToday(day: String): Double
  fun addSpend(day: String, usd: Double)
}

data class AiRunResult(val sent: Int, val saved: Int, val stoppedByCap: Boolean, val error: String?)

class AiRun(
  private val store: AiStore, private val ledger: Ledger, private val provider: () -> OpenAiCompatProvider?, private val prices: () -> Prices,
  private val capUsd: () -> Double?, private val accounts: () -> List<String>, private val channelOf: (Long) -> Channel,
  private val now: () -> Long, private val zone: ZoneId,
  private val atomic: ((() -> Unit) -> Unit) = { it() },
  private val suggestions: ((AiResult, AiInput) -> Unit)? = null,
  /** Autopilot's fast run: only the queue rows marked fast. */
  private val fastOnly: Boolean = false,
) {
  /** One run: batches until the queue is empty, the cap is reached or an error. An item is tried once per run, so a bad reply never loops. */
  fun run(): AiRunResult {
    val provider = provider()
    if (provider == null || store.enabledSince() == null) return AiRunResult(0, 0, false, null)
    val tried = mutableSetOf<Long>()
    var sent = 0
    var saved = 0
    var refusal: String? = null           // the last refusal message; the run reports it so Settings shows it
    var refused: List<Long>? = null       // the previous batch, refused: its failed() waits to see whether the next one is refused too
    while (true) {
      val batch = AiBatch.split(store.queued(FETCH, fastOnly).filter { it.itemId !in tried }).firstOrNull() ?: break
      val t = now()
      val day = LocalDate.ofInstant(Instant.ofEpochMilli(t), zone).toString()   // the cap counts the local day
      val cap = capUsd()
      if (cap != null && store.spentToday(day) >= cap) return AiRunResult(sent, saved, true, CAP_REACHED)
      val reply = try {
        provider.complete(AiBatch.system(), AiBatch.user(batch, accounts(), t, zone))
      } catch (e: AiError) {
        if (e.kind != AiError.Kind.BAD_REQUEST) return AiRunResult(sent, saved, false, e.message)   // the queue is kept as it was
        refusal = e.message
        // Two refused batches in a row mean the setup is wrong (model name, address): keep the whole queue.
        if (refused != null) return AiRunResult(sent, saved, false, refusal)
        // One refused batch gets one retry on a later run, then is dropped; the other batches still go.
        refused = batch.map { it.itemId }
        tried += refused
        continue
      }
      refused?.let(store::failed)
      refused = null
      store.addSpend(day, prices().cost(reply))
      val results = AiBatch.parse(reply.text, batch, zone)
      // Ledger first: a crash between the two leaves the items queued, and onAi on an item it already handled only sets details.
      atomic {
        results.forEach { r ->
          val input = batch.first { b -> b.itemId == r.itemId }
          if (!input.pickedOnly) r.money?.let { ledger.onAi(r.itemId, it, channelOf(r.itemId), input.at) }   // R16: a picked chat's money never reaches the ledger
        }
        store.save(results, t)
        // A bad row must never fail the save; the call sits inside the transaction so a suggestion and its result stand or fall together.
        suggestions?.let { hook -> results.forEach { r -> runCatching { hook(r, batch.first { b -> b.itemId == r.itemId }) } } }
        store.failed(batch.map { it.itemId } - results.map { it.itemId }.toSet())
      }
      tried += batch.map { it.itemId }
      sent += batch.size
      saved += results.size
    }
    if (sent > 0) refused?.let(store::failed)   // only a run where another batch worked proves the setup is fine and this batch is the bad one
    return AiRunResult(sent, saved, false, refusal)
  }

  companion object {
    private const val FETCH = 1_000

    const val CAP_REACHED = "Inflow reached today's AI spending limit. It will send the rest tomorrow, or raise the limit in Settings."
  }
}
