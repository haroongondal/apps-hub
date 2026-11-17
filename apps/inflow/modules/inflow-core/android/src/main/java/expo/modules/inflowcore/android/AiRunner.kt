package expo.modules.inflowcore.android

import android.content.Context
import android.util.Log
import expo.modules.inflowcore.core.AiChannels
import expo.modules.inflowcore.core.AiError
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiRun
import expo.modules.inflowcore.core.AiRunResult
import expo.modules.inflowcore.core.Ask
import expo.modules.inflowcore.core.TxnCategorize
import java.time.ZoneId
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Sends the queue to the owner's model on its own thread, never on the capture thread (R24). Nothing here logs item text, prompts, replies or keys. */
object AiRunner {
  private const val TAG = "AiRunner"
  private const val PERIOD_MIN = 30L
  private const val DUE_MS = 29 * 60_000L   // one minute short of the period, so a timer tick that fires early still runs
  private const val FAILED = "Inflow couldn't finish the AI run. It will try again."
  private const val NO_KEY = "No API key is set. Add your API key in Settings."

  private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "inflow-ai").apply { isDaemon = true } }
  private val periodic = AtomicBoolean(false)
  private val waiting = AtomicBoolean(false)

  /** Every 30 minutes while the process lives; started once from the listener. */
  fun startPeriodic(ctx: Context) {
    if (!periodic.compareAndSet(false, true)) return
    executor.scheduleWithFixedDelay({ runIfDueNow(ctx) }, PERIOD_MIN, PERIOD_MIN, TimeUnit.MINUTES)
  }

  /** Home calls this: a run starts in the background when the last one is over 30 minutes old. Never waits. */
  fun runIfDue(ctx: Context) {
    if (!waiting.compareAndSet(false, true)) return
    executor.execute { waiting.set(false); runIfDueNow(ctx) }
  }

  /** "Send now": waits for any run in progress, then runs. Call it off the main thread. */
  fun runNow(ctx: Context): AiRunResult = executor.submit(Callable { execute(ctx) }).get()

  private fun runIfDueNow(ctx: Context) {
    try {
      val store = StoreHolder.get(ctx).getOrNull() ?: return
      if (!AiConfig(store).on()) return
      val last = store.meta(AiMeta.LAST_RUN_AT)?.toLongOrNull()
      if (last == null || System.currentTimeMillis() - last >= DUE_MS) execute(ctx)
    } catch (e: Exception) {
      Log.w(TAG, "scheduled run failed: ${e.javaClass.simpleName}")
    }
  }

  private fun execute(ctx: Context): AiRunResult {
    val store = StoreHolder.get(ctx).getOrNull() ?: return AiRunResult(0, 0, false, null)
    val cfg = AiConfig(store)
    if (!cfg.on()) return AiRunResult(0, 0, false, null)
    val sms = StoreHolder.smsPackages(ctx)
    val result = try {
      AiRun(
        store, StoreHolder.ledger(store), { cfg.provider() }, { cfg.prices() }, { cfg.capUsd() },
        { SqlLedgerStore(store.db).aiAccounts() }, { store.channelOf(it, sms) }, System::currentTimeMillis, ZoneId.systemDefault(),
        atomic = { block -> store.inTransaction { block() } },
      ).run()
    } catch (e: Exception) {
      Log.w(TAG, "run failed: ${e.javaClass.simpleName}")
      AiRunResult(0, 0, false, FAILED)
    }
    // Every transaction gets a category (a failure here never hides the item run's result).
    val categorised = try {
      TxnCategorize(
        SqlLedgerStore(store.db), { cfg.provider() }, cfg::spend, cfg::capReached, ZoneId.systemDefault(),
        atomic = { block -> store.inTransaction { block() } },
      ).run()
    } catch (e: Exception) {
      Log.w(TAG, "categorise failed: ${e.javaClass.simpleName}")
      0
    }
    store.setMeta(AiMeta.LAST_RUN_AT, System.currentTimeMillis().toString())
    if (result.error != null) store.setMeta(AiMeta.ERROR, result.error) else store.deleteMeta(AiMeta.ERROR)
    if (result.saved + categorised > 0) StoreHolder.onCaptured?.invoke(result.saved + categorised)
    return result
  }

  /** One tiny request with one key. The error copy, or null when the model answered. */
  fun test(ctx: Context, keyId: Long): String? {
    val store = StoreHolder.get(ctx).getOrNull() ?: return FAILED
    val cfg = AiConfig(store)
    val provider = cfg.provider(keyId) ?: return NO_KEY
    return try {
      cfg.spend(provider.complete("Reply with the single word OK.", "Test."))
      null
    } catch (e: AiError) {
      e.message
    } catch (e: Exception) {
      Log.w(TAG, "key test failed: ${e.javaClass.simpleName}")
      FAILED
    }
  }

  /** R29: a planning call, then an answering call over what the plan picked. Only what the queue may send goes out; nothing is stored. */
  fun ask(ctx: Context, question: String): Map<String, Any?> {
    fun reply(answer: String?, error: String?, from: Long = 0, to: Long = 0, items: Int = 0, txns: Int = 0) =
      mapOf("answer" to answer, "error" to error, "from" to from, "to" to to, "items" to items, "txns" to txns)
    val q = question.trim().take(1_000)
    if (q.isEmpty()) return reply(null, "Type a question first.")
    val store = StoreHolder.get(ctx).getOrNull() ?: return reply(null, FAILED)
    val cfg = AiConfig(store)
    val provider = cfg.provider() ?: return reply(null, NO_KEY)
    val zone = ZoneId.systemDefault()
    val now = System.currentTimeMillis()
    fun capReached() = cfg.capUsd()?.let { store.spentToday(cfg.today()) >= it } == true
    return try {
      if (capReached()) return reply(null, AiRun.CAP_REACHED)
      val blocks = cfg.blocks()
      // R44: only SMS and email apps are offered to the plan, so WhatsApp and the rest never even appear in a request.
      val eligible = StoreHolder.smsPackages(ctx) + AiChannels.PKGS
      val apps = store.allAppSettings().filter { it.record && it.pkg in eligible && "app:${it.pkg}" !in blocks }.map { it.pkg to it.label }
      val planReply = provider.complete(Ask.planSystem(), Ask.planUser(q, apps, now, zone))
      cfg.spend(planReply)
      val plan = Ask.parsePlan(planReply.text, now, zone)
      if (capReached()) return reply(null, AiRun.CAP_REACHED)
      // A package the plan made up is not an app of ours; if none is left, the whole range is searched.
      val pkgs = plan.pkgs.filter { p -> apps.any { it.first == p } }
      val since = store.enabledSince() ?: Long.MAX_VALUE
      val items = store.askItems(plan.from, plan.to, pkgs, since, Ask.MAX_ITEMS)
      val txns = if (plan.money) SqlLedgerStore(store.db).askTxns(plan.from, plan.to, Ask.MAX_TXNS) else emptyList()
      val answer = provider.complete(Ask.answerSystem(), Ask.answerUser(q, items, txns, now, zone))
      cfg.spend(answer)
      reply(answer.text.trim(), null, plan.from, plan.to, items.size, txns.size)
    } catch (e: AiError) {
      reply(null, e.message)
    } catch (e: Exception) {
      Log.w(TAG, "ask failed: ${e.javaClass.simpleName}")
      reply(null, "Inflow couldn't answer that. Try again.")
    }
  }
}
