package expo.modules.deputyagent.android

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import expo.modules.deputyagent.applink.AppLinkTarget
import expo.modules.deputyagent.applink.SiblingPackages
import expo.modules.deputyagent.core.Begin
import expo.modules.deputyagent.core.RunStatus
import expo.modules.deputyagent.core.SuggestionItem
import expo.modules.deputyagent.core.SuggestionRef
import expo.modules.deputyagent.core.SuggestionTask

/**
 * Inflow starts this when the owner taps Run on a reply suggestion. Exported, but only apps signed like Deputy hold the
 * AUTOPILOT permission. It shows nothing: it reads the message from Inflow, hands it to `SuggestionTask.begin`, says
 * in a toast what went wrong, and finishes.
 */
class RunSuggestionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val id = intent.getLongExtra(EXTRA_ID, -1L)
      if (id >= 0) toast(run(applicationContext, id, intent.getStringArrayExtra(EXTRA_LOOK_IN)?.toSet().orEmpty()))
    } finally {
      finish()
    }
  }

  private fun toast(message: String?) {
    if (message != null) Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
  }

  companion object {
    const val EXTRA_ID = "suggestionId"
    /** Optional: package names of other apps the run may look in, which Inflow keeps as the owner's choice. */
    const val EXTRA_LOOK_IN = "lookIn"
    private const val AUTHORITY = "com.haroon.inflow.autopilot"
    private const val BASE = "content://$AUTHORITY"

    /** Returns what to tell the owner, or null when the run started. */
    private fun run(context: Context, id: Long, lookIn: Set<String>): String? {
      val item = readItem(context, id) ?: return SuggestionTask.CANT_SHARE
      val result = SuggestionTask.begin(SuggestionRef(id), item, lookIn) { task, apps, untrusted, _ ->
        AgentRuntime.start(context, task, apps, untrusted) { _, r -> if (r.status == RunStatus.DONE) setState(context, id, "done") }
      }
      return when (result) {
        is Begin.Started -> { setState(context, id, "started"); null }
        is Begin.Failed -> result.message
      }
    }

    // Another app can own Inflow's authority: nothing is read from or written to it unless it is the Store-signed Inflow.
    private fun trustedInflow(context: Context) = AppLinkTarget.trustedProvider(context, AUTHORITY, SiblingPackages.INFLOW)

    private fun queryRow(context: Context, path: String): Map<String, String>? =
      context.contentResolver.query(Uri.parse("$BASE/$path"), null, null, null, null)?.use { c ->
        if (!c.moveToFirst()) null else c.columnNames.associateWith { c.getString(c.getColumnIndexOrThrow(it)).orEmpty() }
      }

    private fun readItem(context: Context, id: Long): SuggestionItem? =
      readItem(id, { trustedInflow(context) }) { queryRow(context, it) }

    /** The suggestion row names its source item; an empty row at either step means Inflow refused. `row` is never called unless `trusted()` says yes. */
    internal fun readItem(id: Long, trusted: () -> Boolean, row: (String) -> Map<String, String>?): SuggestionItem? = runCatching {
      val itemId = (if (trusted()) row("suggestions/$id") else null)?.get("item_id")?.toLongOrNull() ?: return@runCatching null
      val r = (if (trusted()) row("items/$itemId") else null) ?: return@runCatching null
      fun s(col: String) = r[col].orEmpty()
      SuggestionItem(s("app"), s("pkg"), s("conversation").ifBlank { s("sender") }, s("text"))
    }.getOrNull()

    private fun setState(context: Context, id: Long, state: String) {
      runCatching {
        if (trustedInflow(context)) context.contentResolver.update(Uri.parse("$BASE/suggestions/$id"), ContentValues().apply { put("state", state) }, null, null)
      }
    }
  }
}
