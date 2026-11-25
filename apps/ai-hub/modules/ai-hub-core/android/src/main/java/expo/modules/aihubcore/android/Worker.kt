package expo.modules.aihubcore.android

import android.content.Context
import android.os.ParcelFileDescriptor
import android.os.RemoteException
import android.os.TransactionTooLargeException
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import expo.modules.aihubcore.IAiHubCallback
import expo.modules.aihubcore.core.Admission
import expo.modules.aihubcore.core.AiError
import expo.modules.aihubcore.core.BadRequest
import expo.modules.aihubcore.core.CallLog
import expo.modules.aihubcore.core.Job
import expo.modules.aihubcore.core.KeyRing
import expo.modules.aihubcore.core.LoggedCall
import expo.modules.aihubcore.core.ModelChoice
import expo.modules.aihubcore.core.PendingApps
import expo.modules.aihubcore.core.Provider
import expo.modules.aihubcore.core.Queue
import expo.modules.aihubcore.core.QueueItem
import expo.modules.aihubcore.core.Request
import expo.modules.aihubcore.core.Results
import expo.modules.aihubcore.core.Service
import expo.modules.aihubcore.core.Settings
import expo.modules.aihubcore.core.Usage
import expo.modules.aihubcore.core.readCapped
import expo.modules.aihubcore.core.routeFor
import expo.modules.aihubcore.core.withImage
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

class Worker(context: Context) {
  private class Pending(
    val key: String,
    val uid: Int,
    val request: Request,
    val pkg: String,
    val attachment: ParcelFileDescriptor?,
    val size: Long,
    val callback: IAiHubCallback,
  ) {
    var running = false
    var started = false
    @Volatile var settled = false
  }

  private val store = HubStore.get(context)
  private val vault = KeyVault.get(context)
  private val transport = OkHttpTransport()
  private val executor = Executors.newScheduledThreadPool(THREADS)
  private val lock = Any()
  private val queue = Queue()
  private val jobs = HashMap<String, Pending>()
  private var stopped = false
  private var ring = KeyRing(emptyList())

  fun switches(): Map<String, Boolean> = Settings.switches(store.get("app_switches"))

  fun models(): Map<Job, ModelChoice> = Settings.models(store.get("models"))

  fun submit(caller: Caller, requestJson: String?, attachment: ParcelFileDescriptor?, callback: IAiHubCallback) {
    val request = try {
      Request.parse(requestJson.orEmpty())
    } catch (e: BadRequest) {
      close(attachment)
      return send(callback, e.requestId) { it.onError(e.requestId, "invalid", e.message) }
    }
    val id = request.requestId
    val cap = request.attachmentCap
    if (cap != null && attachment == null) {
      return send(callback, id) { it.onError(id, "invalid", "Attach the ${request.attachmentName} to the request.") }
    }
    if (cap == null) close(attachment)
    val file = if (cap == null) null else attachment
    val size = file?.let(::regularFileSize)
    val problem = if (file == null) null else request.attachmentProblem(size != null, size ?: 0)
    if (problem != null) {
      close(file)
      return send(callback, id) { it.onError(id, "invalid", problem) }
    }
    val key = "${caller.uid}:$id"
    val service = Settings.key(routeFor(request, models()).choice.service)
    val refusal = synchronized(lock) {
      when {
        stopped -> "cancelled" to "AI hub is closing. Try again."
        key in jobs -> "invalid" to "A request with this id is already waiting or running. Use a new requestId."
        !Admission.admits(jobs.values.map { it.uid }, caller.uid) -> "busy" to "Too many requests are waiting. Try again in a moment."
        else -> {
          jobs[key] = Pending(key, caller.uid, request, caller.pkg, file, size ?: 0, callback)
          queue.enqueue(QueueItem(key, service, request.priority))
          null
        }
      }
    }
    if (refusal != null) {
      close(file)
      return send(callback, id) { it.onError(id, refusal.first, refusal.second) }
    }
    pump()
  }

  fun cancel(caller: Caller, requestId: String?) {
    val key = "${caller.uid}:$requestId"
    val p = synchronized(lock) {
      val p = jobs[key] ?: return
      if (!p.running) {
        queue.cancel(key)
        jobs.remove(key)
      }
      p
    }
    // A running job's thread still reads the attachment, so only run() may close it.
    if (!p.running) close(p.attachment)
    settle(p) { it.onError(p.request.requestId, "cancelled", "The request was cancelled.") }
  }

  fun status(): String {
    val keys = KeyRing(vault.list())
    val now = System.currentTimeMillis()
    val held = synchronized(lock) { Service.entries.associateWith { s -> queue.heldUntil(Settings.key(s))?.takeIf { it > now } } }
    return Settings.status(Service.entries.associateWith { keys.keys(it).size }, held, models())
  }

  fun shutdown() {
    val (all, unstarted) = synchronized(lock) {
      stopped = true
      jobs.values.toList().also { jobs.clear() }.let { it to it.filter { p -> !p.started } }
    }
    // Every unfinished job is still in `jobs`, including those whose tasks shutdownNow() drops.
    executor.shutdownNow()
    unstarted.forEach { close(it.attachment) }
    all.forEach { p ->
      settle(p) { it.onError(p.request.requestId, "cancelled", "AI hub stopped before the request finished. Try again.") }
    }
  }

  private fun pump() {
    val ready = ArrayList<Pair<QueueItem, Pending>>()
    synchronized(lock) {
      if (stopped) return
      while (true) {
        val item = queue.next(System.currentTimeMillis()) ?: break
        val p = jobs[item.id]
        if (p == null) {
          queue.done(item)
        } else {
          p.running = true
          ready += item to p
        }
      }
    }
    for ((item, p) in ready) {
      try {
        executor.execute { run(item, p) }
      } catch (e: RejectedExecutionException) {
        // Only shutdown() rejects, and it closes the attachment of every job that never started.
        settle(p) { it.onError(p.request.requestId, "cancelled", "AI hub is closing. Try again.") }
      }
    }
  }

  private fun run(item: QueueItem, p: Pending) {
    val id = p.request.requestId
    // A job that had not started when shutdown() ran belongs to shutdown(), which settles it and closes its attachment.
    if (!synchronized(lock) { (!stopped).also { p.started = it } }) return
    try {
      val result = execute(p)
      settle(p) { it.onResult(id, result) }
    } catch (e: AiError) {
      if (e.kind == AiError.Kind.RATE) hold(item.service, e.retryAfterMs)
      recordFailure(p, e.kind.name.lowercase(), e.service, e.httpCode, e.fellBack, e.detail)
      settle(p) { it.onError(id, e.kind.name.lowercase(), e.message.orEmpty()) }
    } catch (e: BadRequest) {
      settle(p) { it.onError(id, "invalid", e.message.orEmpty()) }
    } catch (e: Exception) {
      recordFailure(p, "internal", null, null, false, null)
      settle(p) { it.onError(id, "internal", "AI hub hit an unexpected error. Try again.") }
    } catch (e: OutOfMemoryError) {
      settle(p) { it.onError(id, "too_large", "This ${p.request.attachmentName} is too big. Send a smaller one.") }
    } finally {
      close(p.attachment)
      synchronized(lock) {
        queue.done(item)
        jobs.remove(p.key)
      }
      pump()
    }
  }

  private fun execute(p: Pending): String {
    val r = p.request
    val chosen = models()
    val choice = chosen.getValue(r.job)
    val provider = Provider(ring(), transport)
    return when (r.job) {
      Job.CHAT, Job.VISION -> {
        val messages = if (r.job == Job.VISION) withImage(r.messages, r.mime!!, Base64.encodeToString(read(p), Base64.NO_WRAP)) else r.messages
        val route = routeFor(r, chosen)
        val turn = provider.chat(route.choice, messages, r.tools, r.maxTokens, r.reasoningEffort, r.toolChoice, route.fallback)
        record(p.pkg, r.job, turn.served.service, turn.usage.inputTokens, turn.usage.outputTokens)
        Results.chat(turn, r.apiVersion)
      }
      Job.EMBED -> Results.embed(provider.embed(choice, r.texts, r.dimensions), choice.model) { Base64.encodeToString(it, Base64.NO_WRAP) }.also { record(p.pkg, r.job, choice.service, 0, 0) }
      Job.TRANSCRIBE -> Results.transcribe(provider.transcribe(choice, read(p), r.fileName!!, r.mime!!, r.segments)).also { record(p.pkg, r.job, choice.service, 0, 0) }
    }
  }

  private fun read(p: Pending): ByteArray {
    val cap = p.request.attachmentCap!!
    val bytes = ParcelFileDescriptor.AutoCloseInputStream(p.attachment).use { readCapped(it, cap, p.size) { p.settled } }
    return bytes ?: throw BadRequest(p.request.requestId, "The ${p.request.attachmentName} is over ${cap / (1024 * 1024)} MB. Send a smaller one.")
  }

  private fun regularFileSize(pfd: ParcelFileDescriptor): Long? = try {
    Os.fstat(pfd.fileDescriptor).takeIf { OsConstants.S_ISREG(it.st_mode) }?.st_size
  } catch (e: ErrnoException) {
    null
  }

  @Synchronized
  private fun ring(): KeyRing = ring.reuseFor(vault.list()).also { ring = it }

  // A lost usage count or log row must never fail the caller's request, so a write error is dropped.
  @Synchronized
  private fun record(pkg: String, job: Job, service: Service, inputTokens: Long, outputTokens: Long) {
    val now = System.currentTimeMillis()
    runCatching {
      store.put("usage", Usage.fromJson(store.get("usage")).record(pkg, Settings.key(service), inputTokens, outputTokens, now).toJson())
    }
    runCatching {
      store.update("call_log") { CallLog.toJson(CallLog.add(CallLog.parse(it), LoggedCall(pkg, job.name.lowercase(), Settings.key(service), now))) }
    }
  }

  // A failed request gets a row too, so the owner can see which call failed and why (kind and HTTP status only, never the provider's text).
  private fun recordFailure(p: Pending, error: String, service: Service?, httpCode: Int?, fellBack: Boolean, detail: String?) {
    val job = p.request.job
    val used = service ?: runCatching { models().getValue(job).service }.getOrNull() ?: return
    runCatching {
      store.update("call_log") {
        CallLog.toJson(CallLog.add(CallLog.parse(it), LoggedCall(p.pkg, job.name.lowercase(), Settings.key(used), System.currentTimeMillis(), error, httpCode, fellBack, detail)))
      }
    }
  }

  fun notePending(pkg: String) {
    runCatching {
      store.update("pending") { PendingApps.record(PendingApps.parse(it), pkg, System.currentTimeMillis())?.let(PendingApps::toJson) }
    }
  }

  private fun hold(service: String, retryAfterMs: Long?) {
    val wait = synchronized(lock) {
      val now = System.currentTimeMillis()
      queue.onLimited(service, retryAfterMs, now)
      (queue.heldUntil(service) ?: now) - now
    }
    runCatching { executor.schedule({ pump() }, wait, TimeUnit.MILLISECONDS) }
  }

  private fun settle(p: Pending, answer: (IAiHubCallback) -> Unit) {
    val first = synchronized(lock) { !p.settled.also { p.settled = true } }
    if (first) send(p.callback, p.request.requestId, p.request.job, answer)
  }

  private fun send(callback: IAiHubCallback, id: String, job: Job? = null, answer: (IAiHubCallback) -> Unit) {
    try {
      answer(callback)
    } catch (e: TransactionTooLargeException) {
      val fix = when (job) {
        Job.EMBED -> "Send fewer texts at a time."
        Job.TRANSCRIBE -> "Send a shorter recording."
        else -> "Ask for a shorter answer."
      }
      runCatching { callback.onError(id, "too_large", "The reply was too big to send. $fix") }
    } catch (e: RemoteException) {
      return
    }
  }

  private fun close(pfd: ParcelFileDescriptor?) {
    runCatching { pfd?.close() }
  }

  private companion object {
    const val THREADS = 4
  }
}
