package expo.modules.deputyagent.android

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.deputyagent.core.AgentLoop
import expo.modules.deputyagent.core.Gate
import expo.modules.deputyagent.core.Gates
import expo.modules.deputyagent.core.Guard
import expo.modules.deputyagent.core.Msgs
import expo.modules.deputyagent.core.ObservationBuilder
import expo.modules.deputyagent.core.OpenAiCompatProvider
import expo.modules.deputyagent.core.Policy
import expo.modules.deputyagent.core.Prompt
import expo.modules.deputyagent.core.ProviderError
import expo.modules.deputyagent.core.RunEvent
import expo.modules.deputyagent.core.RunStore
import expo.modules.deputyagent.core.TrustLevel
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** SPEC §3: at most one run, owned natively so it outlives Deputy's UI. Service rebinds don't touch it (spikes S3, S9). */
object AgentRuntime {
  private val TIME = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy, HH:mm", Locale.ENGLISH)

  private lateinit var app: Context
  private var store: RunStore? = null
  private val gates = Gates(System::currentTimeMillis)
  private val events = ArrayList<RunEvent>()
  @Volatile private var job: Job? = null
  @Volatile private var runId: String? = null
  @Volatile var listener: ((RunEvent) -> Unit)? = null
  private val scope = CoroutineScope(
    SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, e -> Notifier.finished(app, "Deputy stopped after an internal error: ${e.message}") },
  )

  val active get() = job?.isCompleted == false

  @Synchronized
  fun init(context: Context) {
    if (store != null) return
    app = context.applicationContext
    Notifier.channels(app)
    store = RunStore(File(app.filesDir, "deputy"), System::currentTimeMillis).also {
      it.closeInterrupted()
      it.prune()
    }
  }

  @Synchronized
  fun start(context: Context, task: String, allowedApps: Set<String>?): String {
    init(context)
    check(!active) { "Deputy is already doing a task. Stop it first." }
    check(task.isNotBlank()) { "Type a task first." }
    val service = checkNotNull(DeputyAccessibilityService.instance) { "Turn on the Deputy accessibility service in Setup first." }
    val store = store!!
    val id = UUID.randomUUID().toString().take(8)
    val settings = OwnerStore.settings(app)
    val keys = KeyVault.load(app, settings)
    check(keys.isNotEmpty()) { "Add your API key first." }
    val policy = Policy({ OwnerStore.trust(app).level(it) }, allowedApps, app.packageName)
    val loop = AgentLoop(
      id,
      DeviceAdapter(app),
      OpenAiCompatProvider(settings.baseUrl, settings.model, keys, settings.effort, OkHttpTransport::post),
      gates,
      policy,
      Guard(settings.caps, settings.prices(System.currentTimeMillis()), System::currentTimeMillis, store.spentToday()),
      ObservationBuilder(policy, "Deputy"),
      Prompt.system(Build.VERSION.RELEASE, Locale.getDefault().toLanguageTag(), LocalDateTime.now().format(TIME)),
      ::emit,
      settings.images,
    )
    synchronized(events) { events.clear() }
    runId = id
    store.start(id, task, settings.model, "on_demand")
    runCatching { app.startForegroundService(Intent(app, RunService::class.java)) }
    StopChip.show(service)
    job = scope.launch {
      try {
        // Off the JS thread: recall reads every kept run. The new run has no end line yet, so it is never recalled.
        loop.run(task, store.recall(task, blockedLabels()))
      } finally {
        app.stopService(Intent(app, RunService::class.java))
        StopChip.hide()
        Notifier.clearGate(app)
        store.prune()
      }
    }
    return id
  }

  /** Steps log app labels, so the apps blocked now are named the way the log names them. */
  private fun blockedLabels(): Set<String> = launcherApps(app).map { it.first }.filter { OwnerStore.trust(app).level(it) == TrustLevel.BLOCKED }
    .mapNotNull { runCatching { app.packageManager.run { getApplicationLabel(getApplicationInfo(it, 0)).toString() } }.getOrNull() }.toSet()

  fun stop() {
    job?.cancel()
  }

  fun resolveGate(context: Context, gateId: String, approve: Boolean, text: String?): Boolean {
    val accepted = gates.resolve(gateId, approve, text)
    if (accepted || gates.pending() == null) {
      Notifier.clearGate(context)
      StopChip.clearGate()
    }
    return accepted
  }

  /** The gate waiting now, so a rebound service can show its card again (overlays go with the old connection). */
  fun pendingGate(): Gate? = gates.pending()

  fun snapshot(): Map<String, Any?> = mapOf(
    "runId" to runId,
    "active" to active,
    "events" to synchronized(events) { events.map(::toMap) },
    "gate" to gates.pending()?.let(::toMap),
  )

  suspend fun testProvider(context: Context, keyId: String): Map<String, Any> {
    val settings = OwnerStore.settings(context)
    val key = KeyVault.load(context, settings, keyId) ?: return mapOf("ok" to false, "message" to "That key isn't saved for this model's address.")
    return try {
      OpenAiCompatProvider(settings.baseUrl, settings.model, listOf(key), settings.effort, OkHttpTransport::post).step(listOf(Msgs.user("Reply with the word OK.")), emptyList())
      mapOf("ok" to true, "message" to "The model answered, so the key works.")
    } catch (e: ProviderError) {
      mapOf("ok" to false, "message" to e.message.orEmpty())
    }
  }

  fun history(context: Context, limit: Int): List<Map<String, Any?>> {
    init(context)
    return store!!.list(limit).map {
      mapOf(
        "runId" to it.runId, "task" to it.task, "startedAt" to it.startedAt.toDouble(), "status" to it.status,
        "summary" to it.summary, "costUsd" to it.costUsd, "steps" to it.steps,
      )
    }
  }

  fun readRun(context: Context, runId: String): List<Map<String, Any?>> {
    init(context)
    return store!!.read(runId).map(::toMap)
  }

  @Synchronized
  fun clearHistory(context: Context) {
    init(context)
    store!!.clear()
    if (!active) {
      synchronized(events) { events.clear() }
      runId = null
    }
  }

  private fun emit(e: RunEvent) {
    synchronized(events) { events += e }
    store?.record(e)
    when (e) {
      is RunEvent.Step -> {
        Notifier.progress(app, "Step ${e.n}: ${e.action}")
        StopChip.step(e.n)
      }
      is RunEvent.GateOpened -> {
        Notifier.gate(app, e.gate)
        DeputyAccessibilityService.instance?.let { StopChip.gate(it, e.gate) }
      }
      is RunEvent.Finished -> {
        Notifier.clearGate(app)
        StopChip.clearGate()
        Notifier.finished(app, e.summary ?: e.status.name.lowercase())
      }
    }
    listener?.invoke(e)
  }

  fun toMap(e: RunEvent): Map<String, Any?> = when (e) {
    is RunEvent.Step -> mapOf(
      "type" to "step", "runId" to e.runId, "n" to e.n, "app" to e.app, "action" to e.action,
      "verdict" to e.verdict, "result" to e.result, "costUsd" to e.costUsd, "modelMs" to e.modelMs.toDouble(), "actMs" to e.actMs.toDouble(),
    )
    is RunEvent.GateOpened -> mapOf("type" to "gate", "runId" to e.gate.runId, "gate" to toMap(e.gate))
    is RunEvent.Finished -> mapOf("type" to "finished", "runId" to e.runId, "status" to e.status.name.lowercase(), "summary" to e.summary, "costUsd" to e.costUsd)
  }

  private fun toMap(g: Gate): Map<String, Any?> = mapOf(
    "id" to g.id, "kind" to g.kind.name.lowercase(), "app" to g.app, "action" to g.action, "target" to g.target,
    "draftText" to g.draftText, "reason" to g.reason, "options" to g.options, "expiresAt" to g.expiresAt.toDouble(),
  )
}
