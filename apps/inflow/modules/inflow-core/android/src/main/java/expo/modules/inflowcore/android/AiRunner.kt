package expo.modules.inflowcore.android

import android.content.Context
import android.util.Log
import expo.modules.inflowcore.core.AiChannels
import expo.modules.inflowcore.core.AiError
import expo.modules.inflowcore.core.AiMeta
import expo.modules.inflowcore.core.AiRun
import expo.modules.inflowcore.core.AiRunResult
import expo.modules.inflowcore.core.AUTOPILOT_META
import expo.modules.inflowcore.core.AutopilotSettings
import expo.modules.inflowcore.core.Ask
import expo.modules.inflowcore.core.FastPath
import expo.modules.inflowcore.core.HealthForAsk
import expo.modules.inflowcore.core.Period
import expo.modules.inflowcore.core.ReportRun
import expo.modules.inflowcore.core.ReportSchedule
import expo.modules.inflowcore.core.TxnCategorize
import expo.modules.inflowcore.core.suggestionHook
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
  @Volatile private var lastFastArrivalAt: Long? = null
  @Volatile private var lastFastRunAt: Long? = null
  private val checkPending = AtomicBoolean(false)

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

  /**
   * Autopilot's fast path: Ingest calls this when it queues a picked-chat or person-SMS item. After the quiet window a check on the AI
   * executor runs the fast items (one run at a time, since the executor is single-threaded). A check that finds the one-a-minute gap
   * still open schedules itself again. The timer dies with the process; the rows stay queued and the 30-minute run takes them.
   */
  fun onFastArrival(ctx: Context) {
    lastFastArrivalAt = System.currentTimeMillis()
    if (checkPending.compareAndSet(false, true)) executor.schedule({ fastCheck(ctx) }, FastPath.QUIET_MS, TimeUnit.MILLISECONDS)   // a burst shares one timer chain
  }

  private fun fastCheck(ctx: Context) {
    checkPending.set(false)   // before the decision: an arrival from here on starts a new chain, so none is lost
    val wait = FastPath.waitMs(lastFastArrivalAt, lastFastRunAt, System.currentTimeMillis()) ?: return
    if (wait == 0L) {
      lastFastRunAt = System.currentTimeMillis()
      runFast(ctx)
    } else if (checkPending.compareAndSet(false, true)) {   // still inside the quiet window or the one-a-minute gap
      executor.schedule({ fastCheck(ctx) }, maxOf(wait, 1_000L), TimeUnit.MILLISECONDS)
    }
  }

  /** One run over the fast items only, under the same daily cap and spend counting as [execute]. Runs on the AI executor, never the capture thread. */
  internal fun runFast(ctx: Context): AiRunResult = try {
    execute(ctx, fastOnly = true)
  } catch (e: Exception) {
    Log.w(TAG, "fast run failed: ${e.javaClass.simpleName}")
    AiRunResult(0, 0, false, FAILED)
  }

  private fun runIfDueNow(ctx: Context) {
    try {
      val store = StoreHolder.get(ctx).getOrNull() ?: return
      if (!AiConfig(store).on()) return
      val last = store.meta(AiMeta.LAST_RUN_AT)?.toLongOrNull()
      if (last == null || System.currentTimeMillis() - last >= DUE_MS) execute(ctx)
      else runReports(ctx, store, AiConfig(store))   // Home opened between ticks: a report that came due still gets made
    } catch (e: Exception) {
      Log.w(TAG, "scheduled run failed: ${e.javaClass.simpleName}")
    }
  }

  // fastOnly: the quick run for picked chats. It skips the categoriser and the reports and leaves LAST_RUN_AT alone, so the 30-minute run still takes everything.
  private fun execute(ctx: Context, fastOnly: Boolean = false): AiRunResult {
    val store = StoreHolder.get(ctx).getOrNull() ?: return AiRunResult(0, 0, false, null)
    val suggestions = StoreHolder.suggestions(ctx, store)
    try {
      suggestions.expire(System.currentTimeMillis())   // first thing in every run, whether or not the AI is on
    } catch (e: Exception) {
      Log.w(TAG, "expire failed: ${e.javaClass.simpleName}")
    }
    val cfg = AiConfig(store)
    if (!cfg.on()) return AiRunResult(0, 0, false, null)
    val sms = StoreHolder.smsPackages(ctx)
    val result = try {
      AiRun(
        store, StoreHolder.ledger(store, ctx), { cfg.provider() }, { cfg.prices() }, { cfg.capUsd() },
        { SqlLedgerStore(store.db).aiAccounts() }, { store.channelOf(it, sms) }, System::currentTimeMillis, ZoneId.systemDefault(),
        atomic = { block -> store.inTransaction { block() } },
        suggestions = suggestionHook(suggestions, { AutopilotSettings.fromJson(store.meta(AUTOPILOT_META)) }, System::currentTimeMillis, ZoneId.systemDefault(), store::hasOwnMessageAfter),
        fastOnly = fastOnly,
      ).run()
    } catch (e: Exception) {
      Log.w(TAG, "run failed: ${e.javaClass.simpleName}")
      AiRunResult(0, 0, false, FAILED)
    }
    if (fastOnly) {
      AiMeta.errorAfter(true, result, store.meta(AiMeta.ERROR))?.let { store.setMeta(AiMeta.ERROR, it) } ?: store.deleteMeta(AiMeta.ERROR)
      if (result.saved > 0) StoreHolder.onCaptured?.invoke(result.saved)
      return result
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
    runReports(ctx, store, cfg)
    store.setMeta(AiMeta.LAST_RUN_AT, System.currentTimeMillis().toString())
    if (result.error != null) store.setMeta(AiMeta.ERROR, result.error) else store.deleteMeta(AiMeta.ERROR)
    if (result.saved + categorised > 0) StoreHolder.onCaptured?.invoke(result.saved + categorised)
    return result
  }

  private fun reportRun(ctx: Context, store: SqlItemStore, cfg: AiConfig) = ReportRun(
    SqlReportStore(store.db), { cfg.provider(readMs = AiHttp.REPORT_READ_MS) }, cfg::spend, cfg::capReached,
    { store.meta(StoreHolder.OWNER_NAME)?.takeIf { it.isNotBlank() } }, { SqlLedgerStore(store.db).accounts() },
    System::currentTimeMillis, ZoneId.systemDefault(),
  ) { id, headline -> SqlReportStore(store.db).get(id)?.let { ReportNotifier.notify(ctx, id, headline, it.kind) } }

  /** Makes the weekly and monthly report that came due, if any. A failure here never reaches the item run. */
  private fun runReports(ctx: Context, store: SqlItemStore, cfg: AiConfig) {
    try {
      reportRun(ctx, store, cfg).runDue()
    } catch (e: Exception) {
      Log.w(TAG, "reports failed: ${e.javaClass.simpleName}")
    }
  }

  /** "Make a report now": the week so far, waiting for any run in progress. Call it off the main thread. */
  fun makeReportNow(ctx: Context): Pair<Boolean, String?> =
    makeReport(ctx) { _, now -> ReportSchedule.weekSoFar(now, ZoneId.systemDefault()) }

  /** "Try again" on a report that did not finish. A partial week is remade as the week so far. */
  fun retryReport(ctx: Context, id: Long): Pair<Boolean, String?> =
    makeReport(ctx) { store, now ->
      val row = SqlReportStore(store.db).get(id)
      when {
        row == null -> null
        row.status == ReportRun.READY -> null
        row.partial -> ReportSchedule.weekSoFar(now, ZoneId.systemDefault())
        else -> Period(row.kind, row.periodStart, row.periodEnd, false)
      }
    }

  private fun makeReport(ctx: Context, period: (SqlItemStore, Long) -> Period?): Pair<Boolean, String?> =
    executor.submit(Callable {
      val store = StoreHolder.get(ctx).getOrNull() ?: return@Callable false to FAILED
      try {
        val p = period(store, System.currentTimeMillis()) ?: return@Callable true to null
        reportRun(ctx, store, AiConfig(store)).make(p, manual = true)
      } catch (e: Exception) {
        Log.w(TAG, "report failed: ${e.javaClass.simpleName}")
        false to FAILED
      }
    }).get()

  /** Nothing retries a key test or a question, so the timeout copy says to try again by hand. */
  private fun copy(e: AiError): String? = if (e.kind == AiError.Kind.TIMEOUT) "The AI took too long to answer. Try again." else e.message

  /** One tiny request with one key. The error copy, or null when the model answered. */
  fun test(ctx: Context, keyId: Long): String? {
    val store = StoreHolder.get(ctx).getOrNull() ?: return FAILED
    val cfg = AiConfig(store)
    val provider = cfg.provider(keyId) ?: return NO_KEY
    return try {
      cfg.spend(provider.complete("Reply with the single word OK.", "Test."))
      null
    } catch (e: AiError) {
      copy(e)
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
      val health = HealthForAsk.context(HealthForAsk.on(store.meta(HealthForAsk.META)), SqlHealthStore(store.db), SqlMedicineStore(store), plan.from, plan.to, now, zone)
      val answer = provider.complete(Ask.answerSystem(health != null), Ask.answerUser(q, items, txns, now, zone, health))
      cfg.spend(answer)
      reply(answer.text.trim(), null, plan.from, plan.to, items.size, txns.size)
    } catch (e: AiError) {
      reply(null, copy(e))
    } catch (e: Exception) {
      Log.w(TAG, "ask failed: ${e.javaClass.simpleName}")
      reply(null, "Inflow couldn't answer that. Try again.")
    }
  }
}
