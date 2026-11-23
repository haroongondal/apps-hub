package expo.modules.deputyagent.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.deputyagent.applink.AppLinkActivityCaller
import expo.modules.deputyagent.core.ProposalInbox
import expo.modules.deputyagent.core.ProposeTask
import java.util.UUID

/** PROPOSE_TASK: opens Deputy's draft screen and waits; the caller hears `handed_over` when the owner saves or starts it, `cancelled` when they close it. */
class ProposeTaskActivity : Activity() {
  private var id: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!AppLinkActivityCaller.allowed(this)) return answer(RESULT_CANCELED, "failed", ProposeTask.NOT_ALLOWED)
    if (savedInstanceState != null) return answer(RESULT_CANCELED, "cancelled", ProposeTask.CANCELLED)
    val caller = callingPackage ?: return answer(RESULT_CANCELED, "failed", ProposeTask.NOT_ALLOWED)
    val proposalId = UUID.randomUUID().toString().take(8)
    // Another app built this parcel: a bad one must not crash Deputy.
    val proposal = runCatching {
      ProposeTask.from(proposalId, extrasOf(intent.extras), labelOf(caller), launcherApps(this).toMap())
    }.getOrNull() ?: return answer(RESULT_CANCELED, "failed", ProposeTask.BAD_EXTRAS)
    val open = packageManager.getLaunchIntentForPackage(packageName) ?: return answer(RESULT_CANCELED, "failed", ProposeTask.BAD_EXTRAS)

    id = proposalId
    setResult(RESULT_OK, result("done", ProposeTask.HANDED_OVER))
    setContentView(waitingView())
    ProposalInbox.put(proposal) { kept ->
      runOnUiThread { if (kept) answer(RESULT_OK, "done", ProposeTask.HANDED_OVER) else answer(RESULT_CANCELED, "cancelled", ProposeTask.CANCELLED) }
    }
    startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  override fun onDestroy() {
    id?.let(ProposalInbox::forget)
    super.onDestroy()
  }

  @Suppress("DEPRECATION")
  private fun extrasOf(b: Bundle?): Map<String, Any?> = b?.keySet()?.associateWith { b.get(it) }.orEmpty()

  private fun labelOf(pkg: String): String = runCatching {
    packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
  }.getOrDefault(pkg)

  private fun waitingView() = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER
    val pad = (24 * resources.displayMetrics.density).toInt()
    setPadding(pad, pad, pad, pad)
    addView(TextView(this@ProposeTaskActivity).apply { text = "The suggested task is open in Deputy. Nothing starts until you tap Start there." })
    addView(Button(this@ProposeTaskActivity).apply {
      text = "Open Deputy"
      setOnClickListener { packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    })
  }

  private fun result(status: String, code: String) = Intent().putExtra("status", status).putExtra("code", code)

  private fun answer(resultCode: Int, status: String, code: String) {
    setResult(resultCode, result(status, code))
    finish()
  }
}
