package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import expo.modules.deputyagent.core.NodeRef
import expo.modules.deputyagent.core.Policy
import expo.modules.deputyagent.core.TreeDump
import expo.modules.deputyagent.core.TrustLevel

class DeputyAccessibilityService : AccessibilityService() {
  // Spikes S3, S9: this runs again on rebinds without process death, so it must not reset a run.
  override fun onServiceConnected() {
    instance = this
    AgentRuntime.init(this)
    if (AgentRuntime.active) StopChip.show(this)
  }

  override fun onUnbind(intent: Intent?): Boolean {
    if (instance === this) instance = null
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val pkg = event?.packageName?.toString() ?: return
    if (pkg == packageName) return
    val now = SystemClock.elapsedRealtime()
    // Rule 2: a heads-up's window belongs to System UI, so screenshots wait out one from a blocked app.
    if (event.eventType != AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) lastEventAt = now
    else if (OwnerStore.trust(this).level(pkg) == TrustLevel.BLOCKED) blockedNoticeAt = now
  }

  override fun onInterrupt() = Unit

  fun dumpForeground(): DumpResult {
    val root = rootInActiveWindow ?: return DumpResult(null, 0, "No window could be read. Open an app and try again.")
    val pkg = root.packageName?.toString().orEmpty()
    val policy = Policy(trust = OwnerStore.trust(this)::level, allowedApps = null, self = packageName)
    TreeDump.refusal(policy, pkg)?.let { return DumpResult(pkg, 0, it) }
    val nodes = ArrayList<NodeRef>()
    flatten(root, nodes)
    return DumpResult(pkg, nodes.size, TreeDump.format(pkg, nodes))
  }

  companion object {
    @Volatile var instance: DeputyAccessibilityService? = null
      private set

    @Volatile var lastEventAt = 0L
      private set

    @Volatile var blockedNoticeAt = -HEADS_UP_MS
      private set

    const val HEADS_UP_MS = 10_000L
  }
}

data class DumpResult(val pkg: String?, val nodes: Int, val text: String)
