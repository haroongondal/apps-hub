package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

// Phase 1 spike probes S3, S5, S8 and S9 (docs/deputy/SPEC.md §18). Device-only: delete this file once the results are in the handoff.
object SpikeProbes {
  @Volatile var connectedAt = 0L
  @Volatile private var events = 0L
  @Volatile private var armedAt = 0L
  private val log = ArrayDeque<String>()

  private fun time(ms: Long = System.currentTimeMillis()) = SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(Date(ms))

  fun add(line: String) = synchronized(log) {
    log.addLast("${time()} $line")
    while (log.size > 40) log.removeFirst()
  }

  fun arm() {
    armedAt = SystemClock.elapsedRealtime()
  }

  fun clear() = synchronized(log) { log.clear() }

  fun report(): String = synchronized(log) {
    val since = if (connectedAt == 0L) "never" else time(connectedAt)
    "service connected since $since, $events events seen\n" + log.joinToString("\n")
  }

  fun onEvent(service: AccessibilityService, e: AccessibilityEvent) {
    events++
    val pkg = e.packageName?.toString()
    if (pkg == service.packageName) return
    val notification = e.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED
    if (notification) {
      val n = e.parcelableData as? Notification
      val x = n?.extras
      add(
        "S8 $pkg text=${e.text} title=${x?.getCharSequence(Notification.EXTRA_TITLE)} " +
          "body=${x?.getCharSequence(Notification.EXTRA_TEXT)} big=${x?.getCharSequence(Notification.EXTRA_BIG_TEXT)} category=${n?.category}",
      )
    }
    // S3 waits a minute so Deputy is past Android's grace period after leaving the foreground; earlier starts always pass.
    val waited = if (armedAt == 0L) 0L else (SystemClock.elapsedRealtime() - armedAt) / 1000
    if (waited >= 60 && (notification || e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)) {
      armedAt = 0L
      val screen = if (service.getSystemService(PowerManager::class.java).isInteractive) "on" else "off"
      add("S3 ${waited}s after arming, screen $screen, on a ${if (notification) "notification" else "window change"}: ${startForeground(service)}")
    }
  }

  private fun startForeground(context: Context) = try {
    val started = context.startForegroundService(Intent(context, ProbeForegroundService::class.java))
    if (started == null) "startForegroundService returned null (not started)" else "startForegroundService accepted"
  } catch (t: Throwable) {
    "startForegroundService refused: ${t.javaClass.simpleName}: ${t.message}"
  }

  suspend fun screenshots(service: AccessibilityService): String = try {
    val out = StringBuilder()
    var lastOk = 0L
    for (gap in longArrayOf(0, 200, 350, 500, 750, 1000)) {
      delay(gap)
      val asked = SystemClock.elapsedRealtime()
      val result = shot(service)
      val since = if (lastOk == 0L) "no earlier shot" else "${asked - lastOk} ms after the last accepted shot"
      if (result.startsWith("ok")) lastOk = asked
      out.append("$since: $result in ${SystemClock.elapsedRealtime() - asked} ms\n")
    }
    out.toString().also { add("S5\n$it") }
  } catch (t: Throwable) {
    "Screenshot probe failed: ${t.javaClass.simpleName}: ${t.message}".also { add("S5 $it") }
  }

  private suspend fun shot(service: AccessibilityService): String = withTimeoutOrNull(5_000) {
    suspendCancellableCoroutine { cont ->
      service.takeScreenshot(
        Display.DEFAULT_DISPLAY,
        service.mainExecutor,
        object : AccessibilityService.TakeScreenshotCallback {
          override fun onSuccess(r: AccessibilityService.ScreenshotResult) {
            val b = r.hardwareBuffer
            val size = "${b.width}x${b.height}"
            b.close()
            cont.resume("ok $size")
          }

          override fun onFailure(code: Int) = cont.resume("error ${errorName(code)}")
        },
      )
    }
  } ?: "no answer within 5 s"

  suspend fun typing(service: AccessibilityService): String {
    val node = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
      ?: return "No focused text field. Tap into a text field in another app before the countdown ends."
    if (node.packageName == service.packageName) return "Deputy does not type into its own fields."
    if (node.isPassword) return "Refused: that is a password field."
    val existing = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, existing + "Deputy test")
    }
    val returned = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    delay(500)
    val refreshed = node.refresh()
    val landed = node.text?.toString() == existing + "Deputy test"
    return "S4 ACTION_SET_TEXT returned $returned, refresh $refreshed, text ${if (landed) "changed" else "did not change"} in ${node.packageName} ${node.viewIdResourceName}".also { add(it) }
  }

  private fun errorName(code: Int) = when (code) {
    AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "interval too short"
    AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> "secure window"
    else -> "code $code"
  }
}

class ProbeForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    getSystemService(NotificationManager::class.java)
      .createNotificationChannel(NotificationChannel(CHANNEL, "Deputy spike", NotificationManager.IMPORTANCE_LOW))
    val notification = Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Deputy probe")
      .build()
    try {
      startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
      SpikeProbes.add("S3 startForeground ok")
    } catch (t: Throwable) {
      SpikeProbes.add("S3 startForeground failed: ${t.javaClass.simpleName}: ${t.message}")
    }
    Handler(Looper.getMainLooper()).postDelayed({ stopSelf() }, 10_000)
    return START_NOT_STICKY
  }

  private companion object {
    const val CHANNEL = "deputy-spike"
  }
}
