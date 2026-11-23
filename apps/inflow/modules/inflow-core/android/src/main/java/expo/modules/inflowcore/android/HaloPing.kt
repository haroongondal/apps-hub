package expo.modules.inflowcore.android

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import expo.modules.inflowcore.applink.AppLinkTarget
import expo.modules.inflowcore.core.ChangedPing
import expo.modules.inflowcore.core.ChangedSender
import expo.modules.inflowcore.core.PingDecision
import expo.modules.inflowcore.core.PingTransport
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * "Something changed", to Halo only, with no data: Halo re-reads the shares, which keep their own guard. One ping a minute; the trailing ping of a busy
 * minute lives on this process's timer, so process death drops it (the next change pings again). Independent of the share switches: the ping carries nothing.
 */
object HaloPing {
  // Sent a moment late so a change made inside an open transaction is committed before Halo reads.
  private const val SETTLE_MS = 1_500L
  private val limiter = ChangedPing()
  private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "inflow-ping").apply { isDaemon = true } }

  fun changed(context: Context) {
    val app = context.applicationContext
    val now = SystemClock.elapsedRealtime()
    val delay = when (val d = limiter.request(now)) {
      PingDecision.None -> return
      PingDecision.SendNow -> 0L
      is PingDecision.SendAt -> d.at - now
    }
    runCatching { timer.schedule({ runCatching { ChangedSender.send(transport(app)) } }, delay + SETTLE_MS, TimeUnit.MILLISECONDS) }
  }

  // Explicit (package set), no extras, no fallback: the receiver is asked first, then the broadcast carries the link permission.
  private fun transport(app: Context) = object : PingTransport {
    override fun trusted(action: String, pkg: String) = AppLinkTarget.trustedReceiver(app, Intent(action).setPackage(pkg))

    override fun send(action: String, pkg: String) = app.sendBroadcast(Intent(action).setPackage(pkg), AppLinkTarget.LINK_PERMISSION)
  }
}
