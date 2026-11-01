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
import androidx.media3.transformer.Composition
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.designmedia.core.AtomicFile
import expo.modules.designmedia.core.AttemptLog
import expo.modules.designmedia.core.EncoderStatsStore
import expo.modules.designmedia.core.Job
import expo.modules.designmedia.core.JobState
import expo.modules.designmedia.core.Next
import expo.modules.designmedia.core.QueueEvent
import expo.modules.designmedia.core.QueueStore
import expo.modules.designmedia.core.SizePlan
import expo.modules.designmedia.core.decodeJobs
import expo.modules.designmedia.core.nextRunnable
import expo.modules.designmedia.core.nextSizeAttempt
import expo.modules.designmedia.core.outputName
import expo.modules.designmedia.core.reduce
import expo.modules.designmedia.core.toStatusMap
import java.io.File

// Queue state changes only on [handler]'s thread, which is also the Transformer's looper.
class MediaJobService : Service() {
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private lateinit var store: QueueStore
  private lateinit var notifier: Notifier
  private var current: Run? = null
  private var cbrFirst = false
  @Volatile private var lastStartId = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
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
      notifier.build(TITLE, "Starting", 0, cancelIntent()),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING,
    )
    val action = intent?.action
    val jobs = intent?.getStringExtra(EXTRA_JOBS).orEmpty()
    val id = intent?.getStringExtra(EXTRA_ID).orEmpty()
    val cbr = intent?.getBooleanExtra(EXTRA_CBR_FIRST, false) == true
    guard {
      when (action) {
        ACTION_ENQUEUE -> enqueue(jobs, cbr)
        ACTION_CANCEL -> cancel(id)
        ACTION_CANCEL_ALL -> cancel(ALL)
      }
      pump()
    }
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    handler.post {
      current?.let { abort(it) }
      record(QueueEvent.Pause)
    }
    stopSelf()
  }

  override fun onDestroy() {
    handler.post { current?.let { abort(it) } }
    thread.quitSafely()
    super.onDestroy()
  }

  private fun guard(block: () -> Unit) {
    handler.post {
      try {
        block()
      } catch (e: Exception) {
        current?.let { fail(it.job.id, e.message ?: "Unexpected error.") }
        pump()
      }
    }
  }

  private fun enqueue(json: String, cbr: Boolean) {
    cbrFirst = cbr
    val jobs = decodeJobs(json).map {
      it.copy(state = JobState.QUEUED, progress = 0.0, attempt = 1, outputs = emptyList(), error = null)
    }
    record(QueueEvent.Enqueue(jobs))
  }

  private fun cancel(id: String) {
    current?.takeIf { id == ALL || it.job.id == id }?.let { abort(it) }
    record(QueueEvent.Cancel(id))
  }

  private fun pump() {
    if (current != null) return
    val next = nextRunnable(store.load())
    if (next == null) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf(lastStartId)
      return
    }
    val needed = 2 * next.plan.plannedBytes
    if (cacheDir.usableSpace < needed) {
      fail(next.id, "Not enough free space: needs ${(needed + 999_999) / 1_000_000} MB.")
      pump()
      return
    }
    val run = Run(next, next.plan, if (cbrFirst) CBR else VBR)
    current = run
    record(QueueEvent.Start(next.id, now()))
    attempt(run)
  }

  private fun attempt(r: Run) {
    val dir = File(cacheDir, "jobs/${r.job.id}").apply { mkdirs() }
    val out = File(dir, "attempt-${r.plan.attempt}.mp4").apply { delete() }
    r.startedMs = now()
    r.finished = false
    r.transformer = TransformerRunner.start(
      this, thread.looper, r.plan, Uri.parse(r.job.inputId), out, r.mode == CBR, listener(r, out),
    )
    r.startPolling()
  }

  private fun listener(r: Run, out: File) = object : Transformer.Listener {
    override fun onCompleted(composition: Composition, result: ExportResult) = completed(r, out)

    override fun onError(composition: Composition, result: ExportResult, exception: ExportException) =
      errored(r, exception)
  }

  private fun completed(r: Run, out: File) {
    if (r.aborted) return
    r.finished = true
    r.stopPolling()
    val actual = out.length()
    if (actual == 0L) {
      encoderFailed(r, "The encoder produced no output.")
      return
    }
    val plan = r.plan
    record(QueueEvent.Attempt(r.job.id, AttemptLog(plan.attempt, plan.plannedBytes, actual, (now() - r.startedMs) / 1000.0, r.mode)))
    if (plan.attempt == 1) recordRatio(plan, r.mode, actual)
    when (val next = nextSizeAttempt(plan, actual)) {
      is Next.Publish -> publish(r, out)
      is Next.Retry -> {
        r.plan = next.plan
        record(QueueEvent.Retry(r.job.id, next.plan))
        attempt(r)
      }
      is Next.GaveUp -> {
        fail(r.job.id, next.detail ?: "Couldn't fit under ${plan.targetBytes / 1_000_000} MB.")
        pump()
      }
    }
  }

  private fun errored(r: Run, e: ExportException) {
    if (r.aborted) return
    r.finished = true
    r.stopPolling()
    encoderFailed(r, "The encoder failed: ${ExportException.getErrorCodeName(e.errorCode)}")
  }

  // VBR first; the same attempt runs once in CBR when VBR fails to start or yields nothing (SPEC §9.2, MediaTek).
  private fun encoderFailed(r: Run, message: String) {
    if (r.mode == VBR && !cbrFirst) {
      r.mode = CBR
      attempt(r)
    } else {
      fail(r.job.id, message)
      pump()
    }
  }

  private fun publish(r: Run, out: File) {
    val output = try {
      Outputs.publish(this, out, outputName(r.job.inputName) { Outputs.exists(this, it) })
    } catch (e: Exception) {
      fail(r.job.id, "Couldn't save the output: ${e.message ?: "unknown error"}")
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
    if (!r.finished) r.transformer?.cancel()
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
    val fraction = r.transformer?.let { TransformerRunner.progress(it) } ?: return
    listener?.invoke(EVENT_PROGRESS, mapOf("id" to r.job.id, "fraction" to fraction, "attempt" to r.plan.attempt))
    val jobs = store.load()
    val done = jobs.count { it.state == JobState.DONE || it.state == JobState.FAILED }
    val total = jobs.count {
      it.state == JobState.QUEUED || it.state == JobState.RUNNING || it.state == JobState.DONE || it.state == JobState.FAILED
    }
    val title = "Compressing ${done + 1} of $total"
    notifier.show(NOTIFICATION_ID, notifier.build(title, r.job.inputName, (fraction * 100).toInt(), cancelIntent()))
  }

  private fun record(event: QueueEvent) {
    store.save(reduce(store.load(), event))
    emit()
  }

  private fun emit() {
    listener?.invoke(EVENT_QUEUE, mapOf("jobs" to store.load().map { it.toStatusMap() }))
  }

  private fun cancelIntent(): PendingIntent = PendingIntent.getService(
    this,
    0,
    Intent(this, MediaJobService::class.java).setAction(ACTION_CANCEL_ALL),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  private fun now() = System.currentTimeMillis()

  private inner class Run(val job: Job, var plan: SizePlan, var mode: String) : Runnable {
    var transformer: Transformer? = null
    var aborted = false
    var finished = false
    var startedMs = 0L

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
    const val EVENT_PROGRESS = "onJobProgress"
    const val EVENT_QUEUE = "onQueue"

    private const val TITLE = "Media jobs"
    private const val QUEUE_FILE = "media-queue.json"
    private const val STATS_FILE = "encoder-stats.json"
    private const val ALL = "all"
    private const val VBR = "vbr"
    private const val CBR = "cbr"
    private const val NOTIFICATION_ID = 7201
    private const val POLL_MS = 500L
    private const val ACTION_ENQUEUE = "expo.modules.designmedia.ENQUEUE"
    private const val ACTION_CANCEL = "expo.modules.designmedia.CANCEL"
    private const val ACTION_CANCEL_ALL = "expo.modules.designmedia.CANCEL_ALL"
    private const val EXTRA_JOBS = "jobs"
    private const val EXTRA_CBR_FIRST = "cbrFirst"
    private const val EXTRA_ID = "id"

    fun enqueue(context: Context, jobsJson: String, cbrFirst: Boolean) {
      context.startForegroundService(
        Intent(context, MediaJobService::class.java)
          .setAction(ACTION_ENQUEUE)
          .putExtra(EXTRA_JOBS, jobsJson)
          .putExtra(EXTRA_CBR_FIRST, cbrFirst),
      )
    }

    fun cancel(context: Context, id: String) {
      context.startForegroundService(
        Intent(context, MediaJobService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, id),
      )
    }
  }
}
