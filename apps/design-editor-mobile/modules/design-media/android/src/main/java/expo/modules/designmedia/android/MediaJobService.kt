package expo.modules.designmedia.android

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.AttemptLog
import expo.modules.designmedia.core.CBR
import expo.modules.designmedia.core.ClipPlan
import expo.modules.designmedia.core.EncoderStatsStore
import expo.modules.designmedia.core.GifNext
import expo.modules.designmedia.core.GifPlan
import expo.modules.designmedia.core.Job
import expo.modules.designmedia.core.JobState
import expo.modules.designmedia.core.Messages
import expo.modules.designmedia.core.Next
import expo.modules.designmedia.core.Plan
import expo.modules.designmedia.core.QualityPlan
import expo.modules.designmedia.core.QueueEvent
import expo.modules.designmedia.core.QueueStore
import expo.modules.designmedia.core.SizePlan
import expo.modules.designmedia.core.VBR
import expo.modules.designmedia.core.decodeJobs
import expo.modules.designmedia.core.firstMode
import expo.modules.designmedia.core.neededBytes
import expo.modules.designmedia.core.nextGifAttempt
import expo.modules.designmedia.core.nextRunnable
import expo.modules.designmedia.core.nextSizeAttempt
import expo.modules.designmedia.core.outputExt
import expo.modules.designmedia.core.outputLabel
import expo.modules.designmedia.core.outputName
import expo.modules.designmedia.core.reduce
import expo.modules.designmedia.core.targetFor
import expo.modules.designmedia.core.toStatusMap
import java.io.File

// Queue state changes only on [handler]'s thread, which is also the Transformer's looper.
class MediaJobService : Service() {
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private lateinit var store: QueueStore
  private lateinit var notifier: Notifier
  private var current: Run? = null
  private var cbrOnly = false
  @Volatile private var lastStartId = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    alive = true
    Log.i(TAG, "create ${System.identityHashCode(this)}")
    thread = HandlerThread("design-media").apply { start() }
    handler = Handler(thread.looper)
    store = QueueStore(AtomicFile(File(filesDir, QUEUE_FILE)))
    notifier = Notifier(this)
    handler.post {
      Outputs.deletePending(this)
      File(cacheDir, "jobs").deleteRecursively()
      store.save(reduce(store.load(), QueueEvent.Interrupt))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    startForeground(
      NOTIFICATION_ID,
      notifier.build(Messages.CHANNEL, Messages.STARTING, 0, cancelIntent()),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
    )
    val action = intent?.action
    val jobs = intent?.getStringExtra(EXTRA_JOBS).orEmpty()
    val id = intent?.getStringExtra(EXTRA_ID).orEmpty()
    val cbr = intent?.getBooleanExtra(EXTRA_CBR_ONLY, false) == true
    guard {
      when (action) {
        ACTION_ENQUEUE -> enqueue(jobs, cbr)
        ACTION_CANCEL -> cancel(id)
        ACTION_CANCEL_ALL -> cancel(ALL)
        ACTION_RESUME -> record(QueueEvent.Resume)
        ACTION_CLEAR -> clear()
      }
      pump()
    }
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    // Leave the foreground state before returning, or Android kills the app (ForegroundServiceDidNotStopInTimeException).
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
    handler.post {
      current?.let { abort(it) }
      record(QueueEvent.Pause)
    }
  }

  override fun onDestroy() {
    alive = false
    Log.i(TAG, "destroy ${System.identityHashCode(this)}")
    handler.post { current?.let { abort(it) } }
    thread.quitSafely()
    super.onDestroy()
  }

  private fun guard(block: () -> Unit) {
    handler.post {
      try {
        block()
      } catch (e: Exception) {
        Log.w(TAG, "unexpected error", e)
        current?.let { fail(it.job.id, Messages.WENT_WRONG) }
        pump()
      }
    }
  }

  private fun enqueue(json: String, cbr: Boolean) {
    cbrOnly = cbr
    val jobs = decodeJobs(json).map {
      it.copy(state = JobState.QUEUED, progress = 0.0, attempt = 1, outputs = emptyList(), error = null)
    }
    record(QueueEvent.Enqueue(jobs))
  }

  private fun cancel(id: String) {
    current?.takeIf { id == ALL || it.job.id == id }?.let { abort(it) }
    record(QueueEvent.Cancel(id))
  }

  // Stops what runs, drops what waits, then empties the list. Only the list and temp files go; no output file or row is touched.
  private fun clear() {
    cancel(ALL)
    store.save(emptyList())
    emit()
  }

  private fun pump() {
    if (current != null) return
    val next = nextRunnable(store.load())
    if (next == null) {
      Log.i(TAG, "pump: nothing runnable, stopping")
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(lastStartId)
      return
    }
    val needed = try {
      val input = Uri.parse(next.inputId)
      neededBytes(next.plan, Probe.bytesOf(this, input), if (next.plan is ClipPlan) Probe.source(this, input).durationS else 0.0)
    } catch (e: Exception) {
      Log.w(TAG, "input not readable", e)
      fail(next.id, Messages.COULDNT_OPEN)
      pump()
      return
    }
    if (cacheDir.usableSpace < needed) {
      fail(next.id, Messages.noRoom((needed + 999_999) / 1_000_000))
      pump()
      return
    }
    val run = Run(next, next.plan, firstMode(next.plan))
    current = run
    record(QueueEvent.Start(next.id, now()))
    attempt(run)
  }

  private fun attempt(r: Run) {
    val dir = File(cacheDir, "jobs/${r.job.id}").apply { mkdirs() }
    r.tries++
    val out = File(dir, "attempt-${r.tries}.${outputExt(r.plan)}").apply { delete() }
    r.startedMs = now()
    r.finished = false
    val request = Request(this, thread.looper, handler, r.plan, Uri.parse(r.job.inputId), out, r.mode == CBR)
    try {
      r.runner = Runners.start(request) { outcome -> finishedWith(r, out, outcome) }
    } catch (e: Exception) {
      Log.w(TAG, "${r.plan.tool} did not start", e)
      fail(r.job.id, Messages.COULDNT_PROCESS)
      pump()
      return
    }
    // a runner that fails while starting has already finished and aborted this run; polling it would never stop
    if (!r.aborted && !r.finished) r.startPolling()
  }

  private fun finishedWith(r: Run, out: File, outcome: Outcome) {
    if (r.aborted) return
    r.finished = true
    r.stopPolling()
    when (outcome) {
      is Outcome.Failed -> {
        Log.w(TAG, "${r.plan.tool} failed: ${outcome.detail}")
        encoderFailed(r, Messages.COULDNT_PROCESS)
      }
      is Outcome.Written -> {
        r.label = outcome.label
        completed(r, out)
      }
    }
  }

  private fun completed(r: Run, out: File) {
    val actual = out.length()
    val plan = r.plan
    if (actual == 0L) {
      encoderFailed(r, if (plan is SizePlan || plan is QualityPlan) Messages.NOTHING_MADE else Messages.COULDNT_PROCESS)
      return
    }
    when (plan) {
      is SizePlan -> {
        record(QueueEvent.Attempt(r.job.id, AttemptLog(plan.attempt, plan.plannedBytes, actual, (now() - r.startedMs) / 1000.0, r.mode)))
        if (plan.attempt == 1) recordRatio(plan, r.mode, actual)
        when (val next = nextSizeAttempt(plan, actual)) {
          is Next.Publish -> publish(r, out)
          is Next.Retry -> retry(r, out, next.plan)
          is Next.GaveUp -> giveUp(r, next.detail ?: Messages.overTarget(plan.targetBytes / 1_000_000))
        }
      }
      is GifPlan -> when (val next = nextGifAttempt(plan, actual)) {
        is GifNext.Publish -> publish(r, out)
        is GifNext.Retry -> retry(r, out, next.plan)
        GifNext.GaveUp -> giveUp(r, Messages.overTarget((plan.targetBytes ?: 0) / 1_000_000))
      }
      else -> publish(r, out)
    }
  }

  private fun retry(r: Run, out: File, plan: Plan) {
    out.delete()
    r.plan = plan
    record(QueueEvent.Retry(r.job.id, plan))
    attempt(r)
  }

  private fun giveUp(r: Run, message: String) {
    fail(r.job.id, message)
    pump()
  }

  // CBR first, then VBR once if the phone's encoder fails to start or yields nothing, unless cbrOnly (spike S4).
  private fun encoderFailed(r: Run, message: String) {
    if (r.mode == CBR && !cbrOnly) {
      r.mode = VBR
      attempt(r)
    } else {
      fail(r.job.id, message)
      pump()
    }
  }

  private fun publish(r: Run, out: File) {
    val target = targetFor(r.plan)
    val output = try {
      val name = outputName(r.job.inputName, r.label ?: outputLabel(r.plan), outputExt(r.plan)) { Outputs.exists(this, target, it) }
      Outputs.publish(this, out, name, target)
    } catch (e: Exception) {
      Log.w(TAG, "publish failed", e)
      fail(r.job.id, Messages.COULDNT_SAVE)
      pump()
      return
    }
    release(r)
    record(QueueEvent.Done(r.job.id, listOf(output), now()))
    pump()
  }

  private fun fail(id: String, message: String) {
    current?.takeIf { it.job.id == id }?.let { abort(it) }
    File(cacheDir, "jobs/$id").deleteRecursively()
    record(QueueEvent.Fail(id, message, now()))
  }

  private fun abort(r: Run) {
    r.aborted = true
    if (!r.finished) r.runner?.cancel()
    release(r)
  }

  private fun release(r: Run) {
    r.stopPolling()
    if (current === r) current = null
    File(cacheDir, "jobs/${r.job.id}").deleteRecursively()
  }

  private fun recordRatio(plan: SizePlan, mode: String, actual: Long) {
    if (plan.plannedVideoBytes <= 0) return
    val audioBytes = plan.plannedBytes - plan.plannedVideoBytes - plan.overheadBytes
    val ratio = (actual - audioBytes - plan.overheadBytes).toDouble() / plan.plannedVideoBytes
    EncoderStatsStore(AtomicFile(File(filesDir, STATS_FILE))).record("${plan.encoder}/$mode", ratio)
  }

  private fun report(r: Run) {
    val fraction = r.runner?.progress() ?: return
    listener?.invoke(EVENT_PROGRESS, mapOf("id" to r.job.id, "fraction" to fraction, "attempt" to r.attemptNo))
    val jobs = store.load()
    val done = jobs.count { it.state == JobState.DONE || it.state == JobState.FAILED }
    val total = jobs.count {
      it.state == JobState.QUEUED || it.state == JobState.RUNNING || it.state == JobState.DONE || it.state == JobState.FAILED
    }
    notifier.show(NOTIFICATION_ID, notifier.build(Messages.working(done + 1, total), r.job.inputName, (fraction * 100).toInt(), cancelIntent()))
  }

  private fun record(event: QueueEvent) {
    val before = store.load()
    val after = reduce(before, event)
    store.save(after)
    Log.i(TAG, "${event::class.simpleName}: ${before.size} -> ${after.size} ${after.groupingBy { it.state.wire }.eachCount()}")
    emit()
  }

  // A failed delivery to JS must never stop the queue: the state is already saved.
  private fun emit() {
    try {
      listener?.invoke(EVENT_QUEUE, mapOf("jobs" to store.load().map { it.toStatusMap() }))
    } catch (e: Exception) {
      Log.w(TAG, "queue event not delivered", e)
    }
  }

  private fun cancelIntent(): PendingIntent = PendingIntent.getService(
    this,
    0,
    Intent(this, MediaJobService::class.java).setAction(ACTION_CANCEL_ALL),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private fun now() = System.currentTimeMillis()

  private inner class Run(val job: Job, var plan: Plan, var mode: String) : Runnable {
    var runner: Runner? = null
    var label: String? = null
    var aborted = false
    var finished = false
    var startedMs = 0L
    var tries = 0
    val attemptNo get() = plan.let { if (it is SizePlan) it.attempt else if (it is GifPlan) it.attempt else 1 }

    override fun run() {
      report(this)
      handler.postDelayed(this, POLL_MS)
    }

    fun startPolling() {
      handler.postDelayed(this, POLL_MS)
    }

    fun stopPolling() {
      handler.removeCallbacks(this)
    }
  }

  companion object {
    @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
    @Volatile var alive = false
    const val EVENT_PROGRESS = "onJobProgress"
    const val EVENT_QUEUE = "onQueue"

    private const val TAG = "DesignMediaQueue"
    private const val QUEUE_FILE = "media-queue.json"
    private const val STATS_FILE = "encoder-stats.json"
    private const val ALL = "all"
    private const val NOTIFICATION_ID = 7201
    private const val POLL_MS = 500L
    private const val ACTION_ENQUEUE = "expo.modules.designmedia.ENQUEUE"
    private const val ACTION_CANCEL = "expo.modules.designmedia.CANCEL"
    private const val ACTION_CANCEL_ALL = "expo.modules.designmedia.CANCEL_ALL"
    private const val ACTION_RESUME = "expo.modules.designmedia.RESUME"
    private const val ACTION_CLEAR = "expo.modules.designmedia.CLEAR"
    private const val EXTRA_JOBS = "jobs"
    private const val EXTRA_CBR_ONLY = "cbrOnly"
    private const val EXTRA_ID = "id"

    fun enqueue(context: Context, jobsJson: String, cbrOnly: Boolean) {
      context.startForegroundService(
        Intent(context, MediaJobService::class.java)
          .setAction(ACTION_ENQUEUE)
          .putExtra(EXTRA_JOBS, jobsJson)
          .putExtra(EXTRA_CBR_ONLY, cbrOnly),
      )
    }

    fun cancel(context: Context, id: String) = send(context, ACTION_CANCEL) { putExtra(EXTRA_ID, id) }

    fun resume(context: Context) = send(context, ACTION_RESUME)

    fun clearQueue(context: Context) = send(context, ACTION_CLEAR)

    private fun send(context: Context, action: String, extras: Intent.() -> Unit = {}) {
      context.startForegroundService(Intent(context, MediaJobService::class.java).setAction(action).apply(extras))
    }
  }
}
