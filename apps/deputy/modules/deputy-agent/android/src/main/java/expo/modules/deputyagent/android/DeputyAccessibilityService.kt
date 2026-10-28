package expo.modules.deputyagent.android

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.deputyagent.core.DumpNode
import expo.modules.deputyagent.core.TreeDump

class DeputyAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() {
    instance = this
    SpikeProbes.connectedAt = System.currentTimeMillis()
  }

  override fun onUnbind(intent: Intent?): Boolean {
    if (instance === this) instance = null
    return super.onUnbind(intent)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event != null) SpikeProbes.onEvent(this, event)
  }

  override fun onInterrupt() = Unit

  fun dumpForeground(): DumpResult {
    val root = rootInActiveWindow ?: return DumpResult(null, 0, "No window could be read. Open an app and try again.")
    val pkg = root.packageName?.toString().orEmpty()
    TreeDump.refusal(packageName, pkg)?.let { return DumpResult(pkg, 0, it) }
    val nodes = ArrayList<DumpNode>()
    flatten(root, nodes)
    return DumpResult(pkg, nodes.size, TreeDump.format(pkg, nodes))
  }

  private fun flatten(node: AccessibilityNodeInfo, out: MutableList<DumpNode>) {
    out += DumpNode(
      text = node.text?.toString(),
      desc = node.contentDescription?.toString(),
      hint = node.hintText?.toString(),
      viewId = node.viewIdResourceName,
      clickable = node.isClickable,
      editable = node.isEditable,
      scrollable = node.isScrollable,
      password = node.isPassword,
      visible = node.isVisibleToUser,
    )
    for (i in 0 until node.childCount) node.getChild(i)?.let { flatten(it, out) }
  }

  companion object {
    @Volatile var instance: DeputyAccessibilityService? = null
      private set
  }
}

data class DumpResult(val pkg: String?, val nodes: Int, val text: String)
